/* The rules behind the Analytics overview: the insight cards, the bubble chart's data mapping and its small-data
   fallback, the agents' shares, the budget list's order and the ranked list. */
import { describe, expect, it } from 'vitest';
import { makeEmptyState, makeState } from '@/store/testing';
import type { Site, SpendWire } from '@/store/types';
import {
  agentShares, agentUse, budgetList, bubbleLabel, centreMode, insights, money, names, niceCeil, plotted, scatterLayout, shareText, siteRows, topSites, totals,
  type SiteRow,
} from './model';

const row = (id: string, over: Partial<SiteRow> = {}): SiteRow =>
  ({ id, domain: id + '.example', cc: 'ID', access: 'ok', clicks: 0, today: 0, pct: 0, spend28: 0, tokens28: 0, tone: 'ok', ...over });
const site = (id: string, over: Partial<Site> = {}): Site =>
  ({ id, domain: id + '.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live', access: 'ok', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0, ...over });
const ctx = { budget: 25, gsc: true, admin: true };

describe('site rows', () => {
  it('outside demo mode come from the ledger and Search Console, with the budget the server enforces', () => {
    const s = makeEmptyState();
    const spend: SpendWire = { budget: 20, day: 0, sites: { a: { today: 17, tokensToday: 10, d7: 30, d28: 62.25, tokens28: 1_250_000 } }, agents: {} };
    s.sites = [site('a', { clicks: 420 }), site('b', { access: 'blocked' }), site('c', { access: 'down' })];
    s.live = { ...s.live, spend };
    expect(siteRows(s)).toEqual([
      { id: 'a', domain: 'a.example', cc: 'ID', access: 'ok', clicks: 420, today: 17, pct: 85, spend28: 62.25, tokens28: 1_250_000, tone: 'near' },
      { id: 'b', domain: 'b.example', cc: 'ID', access: 'blocked', clicks: 0, today: 0, pct: 0, spend28: 0, tokens28: 0, tone: 'blocked' },
      { id: 'c', domain: 'c.example', cc: 'ID', access: 'down', clicks: 0, today: 0, pct: 0, spend28: 0, tokens28: 0, tone: 'blocked' },
    ]);
    /* The site filter narrows them. */
    expect(siteRows({ ...s, siteFilter: 'b' }).map(r => r.id)).toEqual(['b']);
  });

  it('in demo mode use the simulation, with 28-day spend estimated from tokens', () => {
    const s = makeState();
    const rows = siteRows(s), a = rows.find(r => r.id === 'a')!;
    expect(rows).toHaveLength(120);
    expect(a).toMatchObject({ clicks: 18420, today: 14.2, tokens28: 1_900_000, tone: 'ok' });
    expect(a.pct).toBeCloseTo(56.8);
    expect(a.spend28).toBeGreaterThan(0);
    /* The same rate for every site: spend follows tokens. */
    const b = rows.find(r => r.id === 'b')!;
    expect(a.spend28 / b.spend28).toBeCloseTo(1.9 / 1.4);
    expect(b.tone).toBe('near');
    expect(rows.find(r => r.id === 'c')!.tone).toBe('blocked');
  });

  it('add up to the four figures, and the ratio waits for both sides', () => {
    const t = totals([row('a', { clicks: 300, today: 5, spend28: 10, tokens28: 1000 }), row('b', { today: 20, spend28: 20, tokens28: 500 })], 25);
    expect(t).toEqual({ sites: 2, clicks: 300, withClicks: 1, today: 25, budgetAll: 50, todayPct: 50, spend28: 30, tokens28: 1500, perUsd: 10 });
    expect(totals([row('a', { spend28: 10 })], 25).perUsd).toBeNull();
    expect(totals([row('a', { clicks: 10 })], 25).perUsd).toBeNull();
    expect(totals([], 25)).toMatchObject({ budgetAll: 0, todayPct: 0, perUsd: null });
    expect([money(0.36), money(3000), money(999.5)]).toEqual(['$0.36', '$3,000.00', '$999.50']);
  });
});

describe('needs attention', () => {
  it('is empty when nothing needs a person', () => {
    expect(insights([row('a', { clicks: 10, spend28: 3, pct: 79.9 }), row('b')], ctx)).toEqual([]);
  });

  it('names a site stopped at 100%, with the waiting jobs and the way out', () => {
    const [x] = insights([row('a', { pct: 101.6, clicks: 5 }), row('b', { pct: 79, clicks: 5 })], { ...ctx, held: 2 });
    expect(x).toMatchObject({
      id: 'stopped', tone: 'bad', sites: ['a.example'], title: 'a.example has used the daily budget of $25.00.',
      body: 'New agent jobs for it are refused and 2 waiting jobs are held until midnight. Raise the budget to start them now.',
      action: { label: 'Open Settings', to: 'settings' },
    });
    /* Someone who cannot change Settings is told who can, and gets no button. */
    const [v] = insights([row('a', { pct: 100, clicks: 5 }), row('b', { pct: 120, clicks: 5 })], { ...ctx, admin: false, held: 1 });
    expect(v.title).toBe('2 sites have used the daily budget of $25.00.');
    expect(v.body).toBe('New agent jobs for them are refused and 1 waiting job is held until midnight. An admin can raise the budget in Settings to start them now.');
    expect(v.sites).toEqual(['b.example', 'a.example']);
    expect(v.action).toBeNull();
  });

  it('lists sites over 80% apart from the stopped ones, highest first', () => {
    const out = insights([row('a', { pct: 80, clicks: 1 }), row('b', { pct: 99.9, clicks: 1 }), row('c', { pct: 100, clicks: 1 })], ctx);
    expect(out.map(x => x.id)).toEqual(['stopped', 'near']);
    expect(out[1]).toMatchObject({ tone: 'warn', title: '2 sites are over 80% of the daily budget.', sites: ['b.example', 'a.example'], action: { to: 'settings' } });
    expect(out[1].body).toBe('b.example (99%) and a.example (80%). Agent jobs stop at 100% until midnight.');
  });

  it('sends blocked and unreachable sites to Build and deploy', () => {
    const out = insights([row('a', { access: 'blocked', clicks: 9 }), row('b', { access: 'down', clicks: 2 }), row('c', { access: 'blocked', clicks: 20 }), row('d', { access: 'pending' })], ctx);
    expect(out.map(x => [x.id, x.title, x.action?.to])).toEqual([
      ['blocked', '2 sites are blocked in their country.', 'deploy'],
      ['down', 'b.example is not reachable in its country.', 'deploy'],
    ]);
    expect(out[0].body).toBe('c.example and a.example. Readers there cannot open the site, so clicks will fall.');
  });

  it('flags spend without clicks only when clicks are measured; otherwise asks for Search Console', () => {
    const rows = [row('a', { spend28: 12.5 }), row('b', { spend28: 3, clicks: 40 }), row('c')];
    expect(insights(rows, ctx)).toMatchObject([{ id: 'noclicks', tone: 'warn', sites: ['a.example'], title: 'a.example has agent spend but no clicks.', action: { label: 'Open Search Console', to: 'gsc' } }]);
    const [g] = insights(rows, { ...ctx, gsc: false });
    expect(g).toMatchObject({ id: 'gsc', tone: 'info', title: 'Clicks are not measured yet.', action: { label: 'Connect Search Console', to: 'integrations' } });
    expect(g.body).toContain('Agents spent $15.50 in 28 days');
    expect(insights(rows, { ...ctx, gsc: false, admin: false })[0].action).toBeNull();
    /* Nothing spent: nothing to say about clicks either way. */
    expect(insights([row('c')], { ...ctx, gsc: false })).toEqual([]);
  });

  it('orders the cards worst first', () => {
    const out = insights([row('a', { pct: 100, access: 'blocked', spend28: 5 }), row('b', { pct: 85, access: 'down', spend28: 5, clicks: 3 })], ctx);
    expect(out.map(x => x.id)).toEqual(['stopped', 'near', 'blocked', 'down', 'noclicks']);
  });

  it('joins names the way people write them', () => {
    expect([names([]), names(['a']), names(['a', 'b']), names(['a', 'b', 'c']), names(['a', 'b', 'c', 'd', 'e'])]).toEqual(['', 'a', 'a and b', 'a, b and c', 'a, b, c and 2 more']);
  });
});

describe('traffic against cost', () => {
  const three = [row('a', { clicks: 4000, spend28: 60, tokens28: 1_000_000, tone: 'near' }), row('b', { clicks: 400, spend28: 25, tokens28: 250_000 }), row('c', { clicks: 0, spend28: 40, tokens28: 500_000, tone: 'blocked' }), row('idle')];

  it('is a chart only with three or more sites and both measures; otherwise a comparison, or nothing', () => {
    expect(centreMode([])).toBe('empty');
    expect(centreMode([row('a'), row('b'), row('c')])).toBe('empty');
    expect(centreMode([row('a', { spend28: 5 })])).toBe('compare');
    expect(centreMode([row('a', { spend28: 5, clicks: 9 }), row('b', { clicks: 2 }), row('idle')])).toBe('compare');
    /* Three sites that spent, no clicks at all (Search Console not connected): every bubble would sit on the baseline. */
    expect(centreMode([row('a', { spend28: 5 }), row('b', { spend28: 2 }), row('c', { spend28: 1 })])).toBe('compare');
    expect(centreMode(three)).toBe('scatter');
    expect(plotted(three).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('maps spend across, clicks up and tokens to size, on square-root scales that keep zero', () => {
    const L = scatterLayout(three, 800, 400);
    const at = (id: string) => L.bubbles.find(b => b.row.id === id)!;
    const { plot } = L;
    expect(L.hidden).toBe(1);
    expect(L.bubbles).toHaveLength(3);
    /* More spend is further right; more clicks is higher (a smaller y); no clicks is on the baseline. */
    expect(at('a').x).toBeGreaterThan(at('c').x);
    expect(at('c').x).toBeGreaterThan(at('b').x);
    expect(at('a').y).toBeLessThan(at('b').y);
    expect(at('c').y).toBe(plot.b);
    /* Square root: a quarter of the axis maximum sits halfway along. */
    const xMax = L.xTicks[L.xTicks.length - 1], yMax = L.yTicks[L.yTicks.length - 1];
    expect([xMax.v, yMax.v, xMax.text, yMax.text]).toEqual([100, 5000, '$100', '5k']);
    expect(at('b').x).toBeCloseTo(plot.l + (plot.r - plot.l) / 2);
    expect(L.xTicks[0]).toMatchObject({ v: 0, at: plot.l, text: '$0' });
    expect(L.yTicks[0]).toMatchObject({ v: 0, at: plot.b, text: '0' });
    /* Area follows tokens: four times the tokens is twice the extra radius. */
    expect(at('a').r).toBe(20);
    expect(at('b').r).toBeCloseTo(6 + 14 / 2);
    /* Everything stays inside the plot, drawn largest first; the keyboard walks from most clicks down. */
    for (const b of L.bubbles) { expect(b.x).toBeGreaterThanOrEqual(plot.l); expect(b.x).toBeLessThanOrEqual(plot.r); expect(b.y).toBeGreaterThanOrEqual(plot.t); expect(b.y).toBeLessThanOrEqual(plot.b); }
    expect(L.bubbles.map(b => b.row.id)).toEqual(['a', 'c', 'b']);
    expect(L.order).toEqual(['a', 'b', 'c']);
  });

  it('names every site when there are few, and leaves out the median guides', () => {
    const L = scatterLayout(three, 800, 400);
    expect(L.bubbles.every(b => b.label)).toBe(true);
    expect(L.guides).toBe(false);
    expect(L.quads).toEqual([]);
  });

  it('with many sites labels only outliers, never two labels on top of each other, and stays readable on a phone', () => {
    const rows = siteRows(makeState());
    for (const [w, h] of [[720, 540], [326, 320]] as const) {
      const L = scatterLayout(rows, w, h);
      const labelled = L.bubbles.filter(b => b.label);
      expect(L.bubbles.length).toBeGreaterThan(90);
      expect(L.bubbles.length + L.hidden).toBe(120);
      expect(labelled.length).toBeGreaterThan(0);
      expect(labelled.length).toBeLessThanOrEqual(6);
      /* With room, the site with the most clicks is among them; on a phone a quadrant name may take its place. */
      if (w > 600) expect(labelled.map(b => b.row.id)).toContain('a');
      const boxes = labelled.map(b => {
        const tw = b.row.domain.length * 6.6 + 4, l = b.label!;
        const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - tw : l.x - tw / 2;
        return { x0, x1: x0 + tw, y0: l.y - 9, y1: l.y + 9 };
      });
      boxes.forEach((p, i) => boxes.slice(i + 1).forEach(q => expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0).toBe(false)));
      boxes.forEach(p => { expect(p.x0).toBeGreaterThanOrEqual(0); expect(p.x1).toBeLessThanOrEqual(w); });
      expect(L.guides).toBe(true);
      expect(Math.max(...L.bubbles.map(b => b.r))).toBeLessThanOrEqual(13);
      expect(L.quads.map(q => q.text)).toContain('High traffic, low cost');
    }
  });

  it('describes a bubble in one sentence', () => {
    expect(bubbleLabel(three[0])).toBe('a.example, ID: 4,000 clicks, $60.00 agent spend and 1.00M tokens in 28 days. Over 80% of budget.');
    expect([niceCeil(18420 * 1.04), niceCeil(9.39), niceCeil(0)]).toEqual([20000, 10, 1]);
  });
});

describe('top sites', () => {
  it('is one list by clicks: top 8 with their share, the rest as one total', () => {
    const rows = Array.from({ length: 11 }, (_, i) => row('s' + i, { clicks: (i + 1) * 100, spend28: i, tokens28: 1000 }));
    const r = topSites(rows);
    expect(r.metric).toBe('clicks');
    expect(r.total).toBe(6600);
    expect(r.items.map(x => x.id)).toEqual(['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3']);
    expect(r.items[0]).toMatchObject({ value: 1100, text: '1,100', secondary: '$10.00' });
    expect(r.items[0].share).toBeCloseTo(1100 / 6600 * 100);
    expect(r.other).toMatchObject({ n: 3, text: '600', secondary: '$3.00' });
    expect(r.items.reduce((n, x) => n + x.share, 0) + r.other!.share).toBeCloseTo(100);
  });

  it('falls back to agent spend while no site has clicks, and has no total row for a short list', () => {
    const r = topSites([row('a', { spend28: 30, tokens28: 9000 }), row('b', { spend28: 10, tokens28: 1500 }), row('c', { spend28: 60, tokens28: 1_250_000 })]);
    expect(r.metric).toBe('spend');
    expect(r.items.map(x => [x.id, x.text, x.secondary, Math.round(x.share)])).toEqual([['c', '$60.00', '1.25M tokens', 60], ['a', '$30.00', '9.0k tokens', 30], ['b', '$10.00', '1.5k tokens', 10]]);
    expect(r.other).toBeNull();
    expect([shareText(0), shareText(0.4), shareText(12.5), shareText(100)]).toEqual(['0%', '<1%', '13%', '100%']);
  });
});

describe('token use by agent', () => {
  it('shares add up to 100, largest first, and only the largest is marked', () => {
    const out = agentShares([
      { id: 'kw', name: 'Keyword', hue: 2, model: 'm', tokens: 1500, cost: 0.12 },
      { id: 'wr', name: 'Content Writer', hue: 4, model: 'm', tokens: 45_000, cost: 3.4 },
      { id: 'bld', name: 'Site Builder', hue: 7, model: 'm', tokens: 3500, cost: 0.3 },
    ]);
    expect(out.map(u => [u.id, +u.share.toFixed(1), u.top])).toEqual([['wr', 90, true], ['bld', 7, false], ['kw', 3, false]]);
    expect(out.reduce((n, u) => n + u.share, 0)).toBeCloseTo(100);
    /* One agent alone is not "the highest"; no tokens is no share. */
    expect(agentShares([{ id: 'wr', name: 'Content Writer', hue: 4, model: 'm', tokens: 10, cost: 0 }])[0]).toMatchObject({ share: 100, top: false });
    expect(agentShares([{ id: 'wr', name: 'Content Writer', hue: 4, model: 'm', tokens: 0, cost: 0.1 }])[0]).toMatchObject({ share: 0, top: false });
    expect(agentShares([])).toEqual([]);
  });

  it('reads the simulation in demo mode and the ledger otherwise', () => {
    const demo = agentShares(agentUse(makeState()));
    expect(demo).toHaveLength(11);
    expect(demo[0]).toMatchObject({ id: 'wr', top: true });
    expect(demo.reduce((n, u) => n + u.share, 0)).toBeCloseTo(100);
    const s = makeEmptyState();
    expect(agentUse(s)).toEqual([]);
    s.live = { ...s.live, spend: { budget: 25, day: 0, sites: {}, agents: { Keyword: { tokens: 1500, cost: 0.12, runs: 1 }, 'Site Builder': { tokens: 0, cost: 0, runs: 0 } } } };
    expect(agentUse(s)).toMatchObject([{ id: 'kw', name: 'Keyword', tokens: 1500, cost: 0.12, runs: 1 }]);
  });
});

describe('spend today against the budget', () => {
  it('lists the sites that spent, highest percentage first, with one sentence on top', () => {
    const b = budgetList([row('a', { today: 5, pct: 20 }), row('b', { today: 25.4, pct: 101.6 }), row('c'), row('d', { today: 20.5, pct: 82 })]);
    expect(b.shown.map(r => r.id)).toEqual(['b', 'd', 'a']);
    expect(b).toMatchObject({ over80: 2, stopped: 1, more: 0, summary: '2 sites are over 80%. 1 has stopped.' });
  });

  it('with many sites shows the ones past half their budget, at most 8', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('s' + String(i).padStart(2, '0'), { today: i + 1, pct: (i + 1) * 4.5 }));
    const b = budgetList(rows);
    expect(b.shown).toHaveLength(8);
    expect(b.shown.map(r => r.pct)).toEqual([90, 85.5, 81, 76.5, 72, 67.5, 63, 58.5]);
    expect(b.more).toBe(12);
    expect(b.summary).toBe('3 sites are over 80%. None has stopped.');
    /* Nobody past half: the highest eight are still listed. */
    const low = budgetList(rows.map(r => ({ ...r, pct: r.pct / 10 })));
    expect(low.shown).toHaveLength(8);
    expect(low.summary).toBe('No site is over 80% of its budget.');
  });

  it('words the summary for one, all and none', () => {
    const s = (pcts: number[]) => budgetList(pcts.map((p, i) => row('s' + i, { today: 1, pct: p }))).summary;
    expect(s([85])).toBe('1 site is over 80%. None has stopped.');
    expect(s([100])).toBe('1 site is over 80%. It has stopped.');
    expect(s([100, 130])).toBe('2 sites are over 80%. All have stopped.');
    expect(s([100, 130, 81])).toBe('3 sites are over 80%. 2 have stopped.');
    expect(budgetList([]).shown).toEqual([]);
  });
});

/* Real articles from the server in the store: the mapping, the Content Writer's live flag, Run history and notifications. */
import { describe, expect, it } from 'vitest';
import { articleContent, serverArticle, T_ART } from './articleFixtures';
import { liveNotifsTo } from './liveNotifs';
import { liveApply, liveArticleTo } from './liveApply';
import { timedSteps } from './liveArticleApply';
import { artOpen, artVisible, reviewCount, waitN } from './rules';
import { makeEmptyState, makeState } from './testing';
import type { AppState, ArticleEvent, ServerArticle } from './types';

const ev = (at: number, action: ArticleEvent['action'], by = 'Content Writer', note = ''): ArticleEvent => ({ at, by, action, note });
const asked = ev(T_ART, 'requested', 'Dana Owner');
const live = (s: AppState, arts: ServerArticle[], ready = true) => { s.live.on = true; arts.forEach(a => { s.live.arts[a.id] = a; }); liveApply(s); s.live.ready = ready; };
const withSite = () => {
  const s = makeEmptyState();
  s.sites.push({ id: 'a', domain: 'kopi.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
  return s;
};

describe('toArticle through liveApply', () => {
  it('maps every server status to a review-queue status', () => {
    const s = makeEmptyState();
    live(s, [
      serverArticle(1, { status: 'queued', content: null }), serverArticle(2, { status: 'work', step: 'Reading the skills', content: null }),
      serverArticle(3, { status: 'revision', pendingNote: 'Shorter.' }), serverArticle(4, { status: 'work', pendingNote: 'Shorter.' }),
      serverArticle(5), serverArticle(6, { status: 'approved' }), serverArticle(7, { status: 'rejected' }), serverArticle(8, { status: 'failed', error: 'Timed out.' }),
    ]);
    expect(s.articles.map(a => [a.id, a.status])).toEqual([
      ['a8', 'failed'], ['a7', 'rejected'], ['a6', 'approved'], ['a5', 'review'], ['a4', 'revisi'], ['a3', 'revisi'], ['a2', 'writing'], ['a1', 'writing'],
    ]);
    expect(s.articles.filter(artOpen).map(a => a.id)).toEqual(['a8', 'a5', 'a4', 'a3', 'a2', 'a1']);
  });

  it('carries the content, the checks, the language review and the site profile', () => {
    const s = makeEmptyState();
    live(s, [serverArticle(5, { revision: 2, languageReview: { by: 'Dewi', at: T_ART }, notes: 'Ran on Claude Sonnet.' }), serverArticle(9, { status: 'queued', content: null, keyword: 'phin filter' })]);
    const [writing, a] = s.articles;
    expect(a).toMatchObject({
      id: 'a5', s: 'a', title: 'Cách pha cà phê phin', titleEn: 'How to brew phin coffee', kw: 'cà phê phin', rev: 2, words: 0, notes: [], paras: [],
      native: { st: 'done', by: 'Dewi' },
      live: { aid: 5, state: 'review', domain: 'domain-a.example', country: 'Vietnam', lang: 'Vietnamese', engine: 'openai-api', engineNotes: 'Ran on Claude Sonnet.' },
    });
    expect(a?.checks[0]).toEqual(['ok', 'Sources cited', '1 source listed']);
    expect(a?.live?.content?.blocks).toHaveLength(4);
    /* Before the first version the keyword stands in for the title. */
    expect(writing).toMatchObject({ title: 'phin filter', titleEn: 'phin filter', native: { st: 'wait' } });
  });

  it('keeps sample articles and puts real ones on top', () => {
    const s = makeState();
    const n = s.articles.length;
    live(s, [serverArticle(5)]);
    expect(s.articles).toHaveLength(n + 1);
    expect(s.articles[0]?.id).toBe('a5');
    liveArticleTo(s, serverArticle(5, { status: 'approved' }));
    expect(s.articles).toHaveLength(n + 1);
    expect(s.articles[0]?.status).toBe('approved');
  });

  it('shows an article whose site is not in the store under "All sites" only, and counts it for review', () => {
    const s = withSite();
    live(s, [serverArticle(5, { siteId: 'gone', domain: 'old.example' }), serverArticle(6)]);
    expect(s.articles.map(a => artVisible(s, a))).toEqual([true, true]);
    expect(reviewCount(s)).toBe(2);
    expect(waitN(s)).toBe(2);
    s.siteFilter = 'a';
    expect(s.articles.map(a => artVisible(s, a))).toEqual([true, false]);
    expect(waitN(s)).toBe(1);
  });
});

describe('the Content Writer, Run history and notifications', () => {
  it('shows the running job on the Content Writer, then waits for human review', () => {
    const s = withSite();
    live(s, [serverArticle(5, { status: 'work', step: 'Reading the skills', content: null, finishedAt: null })]);
    expect(s.agents.find(a => a.id === 'wr')).toMatchObject({ live: true, liveReq: 5, status: 'work', site: 'a', task: 'Writing an article: cà phê phin', progress: 4 });
    liveArticleTo(s, serverArticle(5, { status: 'work', pendingNote: 'Shorter.', siteId: 'gone' }));
    expect(s.agents.find(a => a.id === 'wr')).toMatchObject({ task: 'Revising an article: cà phê phin', site: null });
    /* The finished job shows briefly, then the writer waits for human review. */
    liveArticleTo(s, serverArticle(5), T_ART + 100_000);
    expect(s.agents.find(a => a.id === 'wr')).toMatchObject({ live: false, status: 'idle', task: 'Revising an article: cà phê phin', progress: 100, ended: { ok: true, note: 'Sent to Article review', until: T_ART + 104_000 } });
    liveApply(s, T_ART + 104_000);
    expect(s.agents.find(a => a.id === 'wr')).toMatchObject({ live: false, status: 'wait', task: 'Article awaiting your review: cà phê phin', progress: 0, ended: null });
  });

  it('drops an answer that arrives after the event stream reported a newer change', () => {
    const s = withSite();
    live(s, [serverArticle(5)]);
    liveArticleTo(s, serverArticle(5, { status: 'work', pendingNote: 'Shorter.', updatedAt: T_ART + 200_000 }));
    liveArticleTo(s, serverArticle(5, { status: 'revision', pendingNote: 'Shorter.', updatedAt: T_ART + 199_000 }));
    expect(s.live.arts[5]?.status).toBe('work');
    expect(s.agents.find(a => a.id === 'wr')?.status).toBe('work');
  });

  it('writes each finished or failed job to Run history once, with its duration and tokens', () => {
    const s = makeEmptyState();
    const failed = 'Claude Code did not finish within 15 minutes.';
    live(s, [serverArticle(5), serverArticle(6, { status: 'failed', error: failed, tokens: 0, costUsd: 0, startedAt: T_ART, finishedAt: T_ART + 900_000, history: [asked, ev(T_ART + 900_000, 'failed', 'Content Writer', failed)] }), serverArticle(7, { status: 'queued', content: null, finishedAt: null, history: [asked] })], false);
    expect(s.jobLog.map(r => [r.agent, r.task, r.status, r.dur, r.tokens, r.cost, r.by])).toEqual([
      ['Content Writer', 'Writing an article: cà phê phin', 'Failed', 900, 0, 0, 'Dana Owner'],
      ['Content Writer', 'Writing an article: cà phê phin', 'Done', 90, 1500, 0.12, 'Dana Owner'],
    ]);
    expect(s.jobLog[1]?.steps).toContain('Cited 2 sources');
    expect(s.jobLog[0]?.steps).toEqual(['Started the article', 'Stopped: Claude Code did not finish within 15 minutes.']);
    /* Jobs from before the server recorded step times have no times. */
    expect(s.jobLog[0]?.stepAt).toBeUndefined();
    /* What was already there when the page loaded is in the bell too: notifications come from the server's state. */
    expect(s.notifs.map(n => n.title)).toEqual(['Article failed: cà phê phin', 'Article ready for review: How to brew phin coffee']);
    liveApply(s);
    expect(s.jobLog).toHaveLength(2);
    expect(s.notifs).toHaveLength(2);
  });

  it('shows the step times the server recorded, in seconds from the start of the job', () => {
    const s = makeEmptyState();
    const steps = [{ at: T_ART, text: 'Started the article' }, { at: T_ART + 4_000, text: 'Reading the skills, searching and opening sources' }, { at: T_ART + 90_000, text: 'Cited 2 sources and sent the article to Article review' }];
    live(s, [serverArticle(5, { startedAt: T_ART, finishedAt: T_ART + 90_000, steps })], false);
    expect(s.jobLog[0]?.steps).toEqual(steps.map(x => x.text));
    expect(s.jobLog[0]?.stepAt).toEqual([0, 4, 90]);
    expect(timedSteps([], T_ART)).toBeNull();
  });

  it('announces a new article, a revised one and a failure', () => {
    const s = makeEmptyState(), now = T_ART + 3_600_000;
    const written = ev(T_ART + 95_000, 'written'), revision = ev(T_ART + 300_000, 'revision', 'Linh Reviewer', 'Shorter.');
    const other = { content: articleContent({ titleEn: 'Phin filter care' }) };
    live(s, []);
    liveArticleTo(s, serverArticle(5));
    liveArticleTo(s, serverArticle(6, { status: 'failed', error: 'No JSON.', finishedAt: T_ART + 120_000, history: [asked, ev(T_ART + 120_000, 'failed', 'Content Writer', 'No JSON.')] }));
    liveArticleTo(s, serverArticle(5, { revision: 1, finishedAt: T_ART + 500_000, updatedAt: T_ART + 500_000, history: [asked, written, revision, ev(T_ART + 500_000, 'written')] }));
    liveArticleTo(s, serverArticle(7, { ...other, finishedAt: T_ART + 700_000, updatedAt: T_ART + 700_000, history: [asked, ev(T_ART + 700_000, 'written')] }));
    liveNotifsTo(s, now);
    expect(s.notifs.map(n => [n.k, n.title, n.body, n.view, n.art, n.read])).toEqual([
      ['info', 'Article ready for review: Phin filter care', 'Open Article review.', 'review', 'a7', false],
      ['info', 'A revised article is back in review', 'How to brew phin coffee', 'review', 'a5', false],
      ['bad', 'Article failed: cà phê phin', 'No JSON.', 'review', 'a6', false],
      /* The first version was answered with a revision: nothing left to do, so it shows as read. */
      ['info', 'Article ready for review: How to brew phin coffee', 'Open Article review.', 'review', 'a5', true],
    ]);
    /* Newest finish first; the revision was asked for by the reviewer. */
    expect(s.jobLog.map(r => [r.task, r.by])).toEqual([
      ['Writing an article: cà phê phin', 'Dana Owner'], ['Revising an article: cà phê phin', 'Linh Reviewer'],
      ['Writing an article: cà phê phin', 'Dana Owner'], ['Writing an article: cà phê phin', 'Dana Owner'],
    ]);
    /* A decision does not finish a job: no new run and no new notification, and the one it answered is read. */
    const ids = s.notifs.map(n => n.id);
    liveArticleTo(s, serverArticle(7, { ...other, status: 'approved', finishedAt: T_ART + 700_000, updatedAt: T_ART + 800_000, history: [asked, ev(T_ART + 700_000, 'written'), ev(T_ART + 800_000, 'approved', 'Dana Owner')] }));
    liveNotifsTo(s, now);
    expect([s.jobLog.length, s.notifs.length]).toEqual([4, 4]);
    expect(s.notifs.map(n => n.id)).toEqual(ids);
    expect(s.notifs[0]?.read).toBe(true);
  });
});

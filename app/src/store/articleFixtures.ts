/* Real articles as the server sends them, for tests. */
import type { ArticleContent, ServerArticle } from './types';

export const T_ART = Date.UTC(2026, 9, 2, 8, 0, 0);

export const articleContent = (over: Partial<ArticleContent> = {}): ArticleContent => ({
  title: 'Cách pha cà phê phin', titleEn: 'How to brew phin coffee', titleTag: 'Cách pha cà phê phin | Kopi', metaDescription: 'Tỉ lệ và thời gian.', slug: 'cach-pha-ca-phe-phin',
  byline: { text: 'Ban biên tập', en: 'Editorial team' }, disclosure: { text: 'Soạn với sự hỗ trợ của AI.', en: 'Drafted with AI help.' },
  blocks: [
    { type: 'p', text: 'Cà phê phin là cách pha phổ biến.', en: 'Phin coffee is a common way to brew.' },
    { type: 'h2', text: 'Tỉ lệ', en: 'Ratio' },
    { type: 'list', items: [{ text: 'Cà phê xay thô', en: 'Coarse coffee' }] },
    { type: 'table', rows: [[{ text: 'Tỉ lệ', en: 'Ratio' }, { text: 'Thời gian', en: 'Time' }], [{ text: '1:8', en: '1:8' }, { text: '5 phút', en: '5 minutes' }]] },
  ],
  sources: [{ title: 'Source A', url: 'https://source-a.test/phin' }, { title: 'Bad', url: 'javascript:alert(1)' }],
  reviewerNotes: ['Check the 1:8 ratio at Source A.'],
  ...over,
});

export const serverArticle = (id: number, over: Partial<ServerArticle> = {}): ServerArticle => ({
  id, siteId: 'a', domain: 'domain-a.example', country: 'Vietnam', lang: 'Vietnamese', keyword: 'cà phê phin', requestId: 1, model: 'GPT-6.1 Sol',
  status: 'review', engine: 'openai-api', step: '', revision: 0, pendingNote: '', content: articleContent(),
  checks: [
    { kind: 'ok', name: 'Sources cited', detail: '1 source listed' }, { kind: 'ok', name: 'Title tag', detail: 'Present' },
    { kind: 'ok', name: 'Meta description', detail: 'Present' }, { kind: 'ok', name: 'Keyword in title', detail: 'The title contains the keyword' },
    { kind: 'warn', name: 'Notes to check', detail: '1 note from the agent for the reviewer' }, { kind: 'warn', name: 'Language review', detail: 'Not done yet' },
  ],
  notes: '', languageReview: null,
  history: [{ at: T_ART, by: 'Dana Owner', action: 'requested', note: '' }, { at: T_ART + 95_000, by: 'Content Writer', action: 'written', note: '' }],
  error: '', tokens: 1500, costUsd: 0.12, createdAt: T_ART, startedAt: T_ART + 5_000, finishedAt: T_ART + 95_000, updatedAt: T_ART + 95_000,
  ...over,
});

/** The checks of an article that passes every one (language review done, no notes). */
export const allOk = (by = 'Dewi'): ServerArticle['checks'] => serverArticle(0).checks.map(c => ({ ...c, kind: 'ok', detail: c.name === 'Language review' ? 'Done by ' + by : c.detail }));

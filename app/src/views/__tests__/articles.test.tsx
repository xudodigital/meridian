// @vitest-environment jsdom
/* Real articles from the Content Writer, in the app outside sample-data mode: asking for one from a research result,
   reviewing it in Article review (every decision calls the server), and how it shows in Workspace, Run history and
   the navigation. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SideNav } from '@/shell/SideNav';
import { allOk, articleContent, serverArticle } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { liveApply } from '@/store/live';
import { ARTICLE_QUEUED } from '@/store/slices/content';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { BuildWire, EngineStatus, ServerArticle, ServerRequest } from '@/store/types';
import { History } from '../History';
import { Research } from '../Research';
import { Review } from '../Review';
import { Workspace } from '../Workspace';

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
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string) => $$(sel).find(e => e.textContent === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (el: HTMLTextAreaElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
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
const change = (fn: () => void) => act(async () => { fn(); });

const engineOn: EngineStatus = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** fetch answering every call with `answer(url, body)`; the calls are kept for assertions. */
function server(answer: (url: string, body: Record<string, unknown>) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => answer(url, JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>));
  vi.stubGlobal('fetch', fn);
  return { fn, calls: () => fn.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body ?? '{}'))] as const) };
}
const goLive = (arts: ServerArticle[] = [], reqs: ServerRequest[] = []) => change(() => useStore.setState(d => {
  d.live.on = true; d.live.engine = engineOn; reqs.forEach(r => { d.live.reqs[r.id] = r; }); arts.forEach(a => { d.live.arts[a.id] = a; }); liveApply(d); d.live.ready = true;
}));
let site = '';

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
  site = st().sites[0]!.id;
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const art = (id: number, over: Partial<ServerArticle> = {}) => serverArticle(id, { siteId: site, domain: 'kopi.example', ...over });

describe('a real article in Article review', () => {
  it('shows the whole article, its sources, notes, checks and history, without sample wording', async () => {
    await goLive([art(5)]);
    await mount(<Review />);
    expect($$('#rvlist .art b').map(b => b.textContent)).toEqual(['How to brew phin coffee']);
    expect($('#rvlist .art .chip')?.textContent).toBe('VN · kopi.example');
    expect($('.rvd h2')?.textContent).toBe('Cách pha cà phê phin');
    expect($$('.rvd .tags .tag').map(t => t.textContent)).toEqual(['languageVN · kopi.example', 'translateVietnamese', 'keycà phê phin', 'historyRevision 0', 'smart_toyOpenAI']);
    expect($$('.rvd h3').map(h => h.textContent)).toEqual(['Automated checks', 'Native-speaker review', 'Search appearance', 'Photos', 'Article', 'Sources', 'Notes from the agent', 'History']);
    expect($$('.rvd .checks .pill').slice(0, 6).map(p => p.textContent)).toEqual(['Sources cited', 'Title tag', 'Meta description', 'Keyword in title', 'Notes to check', 'Language review']);
    const appearance = $$('.rvd table')[0]!;
    expect([...appearance.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual(['Title tagCách pha cà phê phin | Kopi', 'Meta descriptionTỉ lệ và thời gian.', 'URL slugcach-pha-ca-phe-phin', 'CategoryNone']);
    const rows = [...$$('table.bi tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    expect(rows).toEqual([
      ['H1 Cách pha cà phê phin', 'H1 How to brew phin coffee'],
      ['Byline Ban biên tập', 'Byline Editorial team'],
      ['Cà phê phin là cách pha phổ biến.', 'Phin coffee is a common way to brew.'],
      ['H2 Tỉ lệ', 'H2 Ratio'],
      ['Cà phê xay thô', 'Coarse coffee'],
      ['Table Tỉ lệ | Thời gian', 'Table Ratio | Time'],
      ['1:8 | 5 phút', '1:8 | 5 minutes'],
      ['How it was made Soạn với sự hỗ trợ của AI.', 'How it was made Drafted with AI help.'],
    ]);
    expect($('table.bi th')?.textContent).toBe('Original (Vietnamese)');
    const links = $$('.rvd ol a');
    expect(links.map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])).toEqual([['Source A', 'https://source-a.test/phin', '_blank', 'noopener noreferrer']]);
    expect($$('.rvd ol li')[1]?.textContent).toBe('Bad');
    expect($('a[href^="javascript"]')).toBeNull();
    expect(text()).toContain('Check the 1:8 ratio at Source A.');
    expect(text()).toContain('Dana Owner asked for the article');
    expect(text()).toContain('Content Writer finished a version');
    expect(text()).not.toContain('Sample excerpt');
    expect(text()).not.toContain('(simulated)');
    expect(byText('.rvd button', 'Mark as done')).not.toBeNull();
    expect(byText('.decide button', 'checkApprove')?.hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Approving does not publish the article by itself: it goes into the next website build of its site');
  });

  it('records the language review under the signed-in name, then approves on the server', async () => {
    await goLive([art(5)]);
    await mount(<Review />);
    const reviewed = art(5, { languageReview: { by: 'Dana Owner', at: Date.now() }, checks: allOk('Dana Owner') });
    const srv = server(url => json({ article: url.endsWith('/approve') ? { ...reviewed, status: 'approved', history: [...reviewed.history, { at: Date.now(), by: 'Dana Owner', action: 'approved', note: '' }] } : reviewed }));
    await click(byText('.rvd button', 'Mark as done'));
    await settle();
    expect(srv.calls()).toEqual([['/api/articles/5/language-review', {}]]);
    expect(st().articles[0]?.native).toMatchObject({ st: 'done', by: 'Dana Owner' });
    expect(st().snackMsg?.msg).toBe('Finished the language review: How to brew phin coffee');

    await click(byText('.decide button', 'checkApprove'));
    await settle();
    expect(srv.calls()[1]).toEqual(['/api/articles/5/approve', {}]);
    expect(st().articles[0]?.status).toBe('approved');
    expect(st().snackMsg?.msg).toBe('Approved (not published): How to brew phin coffee');
    await click(byText('.tabs [role="tab"]', 'Decided (1)'));
    expect($('.rvd .pill')?.textContent).toBe('Approved, not published');
    expect($('.rvd .callout')?.textContent).toBe('verifiedApproved, not published yet. It goes on the site with the next website build, once that build is approved in Build and deploy.');
    expect($('.decide')).toBeNull();
  });

  it('requires a note for a revision and sends it; rejects through the confirm dialog', async () => {
    const filter = { keyword: 'phin filter', content: articleContent({ title: 'Phin', titleEn: 'Phin filters' }) };
    await goLive([art(5), art(6, filter)]);
    await mount(<Review />);
    /* Newest first: article 6 is selected. */
    expect($('#rvlist .art.on b')?.textContent).toBe('Phin filters');
    const srv = server((url, body) => json({ article: url.includes('/6/') ? art(6, { ...filter, status: 'revision', pendingNote: String(body.note) }) : art(5, { status: 'rejected' }) }));
    await click(byText('.decide button', 'Request revision'));
    expect($('.decide .err')?.textContent).toBe('Write a revision note first, so the agent knows what to change.');
    expect(srv.fn).not.toHaveBeenCalled();
    await type($<HTMLTextAreaElement>('#rvNote'), 'Cite the ratio source.');
    await click(byText('.decide button', 'Request revision'));
    await settle();
    expect(srv.calls()).toEqual([['/api/articles/6/revise', { note: 'Cite the ratio source.' }]]);
    expect(st().articles.find(a => a.id === 'a6')?.status).toBe('revisi');
    expect(st().snackMsg?.msg).toBe('Requested a revision: Phin filters');

    await click(byText('#rvlist .art b', 'Phin filters')?.closest('button') ?? null);
    expect($('.rvd h3')?.textContent).toBe('Status');
    expect(text()).toContain('Revision note: Cite the ratio source.');
    expect($('.decide')).toBeNull();

    await click(byText('#rvlist .art b', 'How to brew phin coffee')?.closest('button') ?? null);
    await click(byText('.decide button', 'Reject'));
    expect(st().confirm).toMatchObject({ key: 'art:a5', title: 'Reject this article?' });
    await act(async () => { st().confirmOk(); });
    await settle();
    expect(srv.calls()[1]).toEqual(['/api/articles/5/reject', {}]);
    expect(st().articles.find(a => a.id === 'a5')?.status).toBe('rejected');
    expect(st().snackMsg?.msg).toBe('Rejected the article: How to brew phin coffee');
  });

  it('tells where an approved article is on its way to the site, from the site\'s website builds', async () => {
    const ok = { checks: allOk(), languageReview: { by: 'Dewi', at: 1 } };
    await goLive([art(5, { ...ok, status: 'approved' }), art(6, ok)]);
    await change(() => st().setRtab('done'));
    await mount(<Review />);
    const callout = () => $('.rvd .callout')?.textContent;
    const builds = (...list: BuildWire[]) => change(() => useStore.setState(d => { d.live.builds = Object.fromEntries(list.map(b => [b.id, b])); }));
    const v1 = (over: Partial<BuildWire>) => buildWire(1, site, 'kopi.example', 1, { articles: [5], ...over });
    expect(callout()).toBe('verifiedApproved, not published yet. It goes on the site with the next website build, once that build is approved in Build and deploy.');
    /* A build without the article changes nothing. */
    await builds(v1({ articles: [7], review: 'approved', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: Date.UTC(2026, 9, 3, 9, 5) }));
    expect(callout()).toContain('It goes on the site with the next website build');
    await builds(v1({}));
    expect(callout()).toBe('verifiedApproved, not published yet. It is in v1 of kopi.example, a website build that waits for approval in Build and deploy.');
    await builds(v1({ review: 'approved' }));
    expect(callout()).toBe('verifiedApproved, not live yet. It is in v1 of kopi.example, which is approved but not deployed. Deploy it in Build and deploy, or download its ZIP for any static host.');
    await builds(v1({ review: 'approved', deploy: 'failed' }));
    expect(callout()).toContain('which is approved but its deploy failed. Try the deploy again in Build and deploy');
    await builds(v1({ review: 'approved', deploy: 'work' }));
    expect(callout()).toBe('rocket_launchGoing live. It is in v1 of kopi.example, which is being put live on Cloudflare Pages now.');
    await builds(v1({ review: 'approved', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: Date.UTC(2026, 9, 3, 9, 5) }));
    expect(callout()).toMatch(/^publicLive on the site\. It is in v1 of kopi\.example, live since 3 Oct, \d\d:05\. open_in_newOpen live site$/);
    expect($('.rvd .callout a')?.getAttribute('href')).toBe('https://kopi-example.pages.dev');
    /* A newer version without it does not hide that it is live in v1. */
    await builds(v1({ review: 'approved', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: 1 }), buildWire(2, site, 'kopi.example', 2, { articles: [5, 6] }));
    expect(callout()).toContain('Live on the site. It is in v1 of kopi.example');

    /* With "Require approval before a deploy" off, nobody approves the build again. */
    await builds();
    await change(() => st().setSystemSetting('apDeploy', false));
    expect(callout()).toBe('verifiedApproved, not published yet. It goes on the site with the next website build. “Require approval before a deploy” is off in Settings, so that build is approved by itself and goes live as soon as it is built when Cloudflare is connected.');
    await change(() => st().setRtab('open'));
    expect($('.decide .note')?.textContent).toBe('Approving does not publish the article by itself: it goes into the next website build of its site, and “Require approval before a deploy” is off in Settings, so that build goes live as soon as it is built when Cloudflare is connected, without a second approval.');
    await change(() => st().setSystemSetting('apDeploy', true));
    expect($('.decide .note')?.textContent).toBe('Approving does not publish the article by itself: it goes into the next website build of its site, which is approved again before it goes live.');
  });

  it('tells a native reviewer only who puts an approved article on the site', async () => {
    await goLive([art(5, { status: 'approved', checks: allOk(), languageReview: { by: 'Dewi', at: 1 } })]);
    await change(() => { st().signIn(meFor('reviewer', 'Linh Reviewer', 'linh@example.com')); useStore.setState(d => { d.session!.site = site; d.siteFilter = site; }); st().setRtab('done'); });
    await mount(<Review />);
    expect($('.rvd .callout')?.textContent).toBe('verifiedApproved. An editor or admin puts it on the site with a website build.');
  });

  it('shows the server refusal under the decision buttons', async () => {
    await goLive([art(5, { checks: allOk(), languageReview: { by: 'Dewi', at: 1 } })]);
    await mount(<Review />);
    server(() => json({ error: 'This article is not waiting for review.' }, 409));
    await click(byText('.decide button', 'checkApprove'));
    await settle();
    expect($('.decide .err')?.textContent).toBe('This article is not waiting for review.');
    expect(st().articles[0]?.status).toBe('review');
  });

  it('approves every real article that passes every check, one server call each', async () => {
    const ok = { checks: allOk(), languageReview: { by: 'Dewi', at: 1 } };
    await goLive([art(5, ok), art(6, { ...ok, keyword: 'phin filter' }), art(7)]);
    await mount(<Review />);
    const srv = server(url => { const id = Number(url.split('/')[3]); return json({ article: art(id, { ...ok, status: 'approved' }) }); });
    await click(byText('.sh button', 'done_allApprove 2 that pass every check'));
    await settle();
    expect(srv.calls().map(c => c[0])).toEqual(['/api/articles/6/approve', '/api/articles/5/approve']);
    expect(st().articles.map(a => a.status)).toEqual(['review', 'approved', 'approved']);
    expect(st().snackMsg?.msg).toBe('Approved 2 articles at once');
  });

  it('shows the step while writing, and offers Try again after a failure', async () => {
    await goLive([art(8, { status: 'work', step: 'Reading the skills, searching and opening sources', content: null, finishedAt: null }), art(9, { status: 'failed', keyword: 'phin filter', content: null, error: 'Claude Code did not finish within 15 minutes.' })]);
    await mount(<Review />);
    expect($$('#rvlist .art .pill').map(p => p.textContent)).toEqual(['Failed', 'Agent is writing']);
    expect($('.rvd h2')?.textContent).toBe('phin filter');
    expect($('.rvd .callout')?.textContent).toBe('errorClaude Code did not finish within 15 minutes.');
    const srv = server(() => json({ article: art(9, { status: 'queued', keyword: 'phin filter', content: null }) }));
    await click(byText('.rvd button', 'refreshTry again'));
    await settle();
    expect(srv.calls()).toEqual([['/api/articles/9/retry', {}]]);
    expect(st().articles.find(a => a.id === 'a9')?.status).toBe('writing');

    await click($$('#rvlist .art')[1] ?? null);
    expect(text()).toContain('Reading the skills, searching and opening sources');
    expect($('.decide')).toBeNull();
  });
});

describe('Write article from a research result', () => {
  const req = (over: Partial<ServerRequest> = {}): ServerRequest => ({
    id: 3, siteId: site, domain: 'kopi.example', country: 'Vietnam', lang: 'Vietnamese', topic: 'phin', goal: 'Find a new topic cluster', status: 'done', engine: 'openai-api', step: '',
    summary: 'Two ideas.', notes: '', error: '', tokens: 900, costUsd: 0.01, createdAt: Date.UTC(2026, 9, 2, 7), startedAt: 1000, finishedAt: 5000,
    keywords: [{ keyword: 'cà phê phin', meaning: 'phin coffee', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' }, { keyword: 'phin filter', meaning: 'phin filter', intent: 'Commercial', cluster: 'Gear', basis: 'Seed' }],
    ...over,
  });
  const openSheet = async (keyword: string) => {
    await click(byText('button', 'View result'));
    const row = $$('dialog[open] tbody tr').find(tr => tr.querySelector('b')?.textContent === keyword);
    await click(row?.querySelector('button') ?? null);
  };
  const sheet = () => $$('dialog[open]').find(d => d.querySelector('#waT'));

  it('confirms site, keyword, model and cost, then sends it to the Content Writer', async () => {
    await change(() => st().setRctab('keywords'));
    await goLive([], [req()]);
    await mount(<Research />);
    await openSheet('cà phê phin');
    const s = sheet();
    expect(s?.querySelector('h2')?.textContent).toBe('Write an article');
    expect([...(s?.querySelectorAll('.tag') ?? [])].map(t => t.textContent)).toEqual(['languagekopi.example · Vietnam', 'translateVietnamese', 'keycà phê phin', 'memoryContent Writer: GPT-6.1 Sol']);
    expect(s?.querySelector('p.note')?.textContent).toBe('Writing takes several minutes and uses your OpenAI API quota.');

    const srv = server(() => json({ article: art(11, { status: 'queued', content: null }) }, 201));
    await click(byText('dialog[open] button', 'edit_noteSend to Content Writer'));
    await settle();
    expect(srv.calls()).toEqual([['/api/articles', {
      siteId: site, domain: 'kopi.example', country: 'Vietnam', lang: 'Vietnamese', siteTopic: 'Coffee', keyword: 'cà phê phin', requestId: 3, model: 'GPT-6.1 Sol',
    }]]);
    expect(sheet()).toBeUndefined();
    expect($('dialog[open] h2')?.textContent).toBe('phin');
    expect(st().snackMsg?.msg).toBe('Article sent to the Content Writer.');
    /* The server writes "Requested an article" to the audit log under the session's person; the page adds nothing. */
    expect(st().log.map(l => l.act)).toEqual(['Added kopi.example (Vietnam)']);
    expect(st().articles[0]).toMatchObject({ id: 'a11', status: 'writing' });

    /* The same keyword cannot be asked for again: its row says the article is on its way and has no button. */
    const row = $$('dialog[open] tbody tr')[0];
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.textContent).toContain('Article on its way');
    expect(await st().sendArticle({ rid: 3, keyword: 'cà phê phin' })).toBe(ARTICLE_QUEUED);
    expect(srv.fn).toHaveBeenCalledTimes(1);
  });

  it('shows the server refusal, and uses the profile stored on a request whose site was removed', async () => {
    await change(() => st().setRctab('keywords'));
    await goLive([], [req({ siteId: 'gone', domain: 'old.example', country: 'Indonesia', lang: 'Indonesian' })]);
    await mount(<Research />);
    await openSheet('phin filter');
    expect([...(sheet()?.querySelectorAll('.tag') ?? [])].map(t => t.textContent).slice(0, 2)).toEqual(['languageold.example · Indonesia', 'translateIndonesian']);
    const srv = server(() => json({ error: 'An article for this keyword is already queued, being written or waiting for review for that site.' }, 409));
    await click(byText('dialog[open] button', 'edit_noteSend to Content Writer'));
    await settle();
    expect(srv.calls()[0]?.[1]).toMatchObject({ siteId: 'gone', domain: 'old.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: '' });
    expect(sheet()?.querySelector('.err')?.textContent).toBe('An article for this keyword is already queued, being written or waiting for review for that site.');
    expect(byText('dialog[open] button', 'edit_noteSend to Content Writer')?.hasAttribute('disabled')).toBe(false);
  });

  it('is refused for a viewer', async () => {
    await change(() => { st().setRctab('keywords'); st().signIn(meFor('viewer', 'Viewer', 'viewer@example.com')); });
    await goLive([], [req()]);
    await mount(<Research />);
    await openSheet('cà phê phin');
    expect(sheet()).toBeUndefined();
    expect(st().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
  });
});

describe('everywhere else, with nothing invented', () => {
  it('shows the Content Writer working, the run in Run history and the review count in the navigation', async () => {
    await goLive([art(5, { status: 'work', step: 'Reading the skills', content: null, finishedAt: null, tokens: 0, costUsd: 0 })]);
    await mount(<Workspace />);
    const desk = $('#desk-wr');
    expect(desk?.getAttribute('data-st')).toBe('work');
    /* The task line ends with the server's current step. */
    expect(desk?.querySelector('.task')?.textContent).toBe('Writing an article: cà phê phin · Reading the skills');
    expect(desk?.querySelector('.tags')?.textContent).toContain('VN · kopi.example');
    await mount(<History />);
    expect(text()).toContain('No runs yet');

    await change(() => useStore.setState(d => { d.live.arts[5] = art(5); liveApply(d); }));
    expect(st().agents.find(a => a.id === 'wr')).toMatchObject({ status: 'idle', live: false });
    const cells = [...($('tbody tr')?.querySelectorAll('td') ?? [])].map(td => td.textContent);
    expect([cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7]]).toEqual(['Content Writer', 'Writing an article: cà phê phinAsked by Dana Owner', 'VN · kopi.example', '1m 30s', '2K', '$0.12', 'Done']);
    expect(st().notifs[0]).toMatchObject({ title: 'Article ready for review: How to brew phin coffee', view: 'review' });

    await mount(<SideNav view="workspace" />);
    expect(byText('.navgroup button', 'rate_reviewArticle review1')?.querySelector('.count')?.textContent).toBe('1');
  });

  it('keeps Article review empty and honest without the server', async () => {
    await mount(<Review />);
    expect(text()).toContain('No articles to review yet');
    expect($$('.rvd')).toEqual([]);
    expect(st().articles).toEqual([]);
  });
});

/* Content slice: Article review, Reports, Run history. Owner: the content screens builder.
   Ports the prototype's rv-* actions (lines 2126-2133), the review-mode change (2187), the report settings
   (data-set, 2189) and rep-send (2091). Reject goes through the core confirm dialog (openConfirm('art:<id>')).
   Whatever takes the open article off the screen (another article, another tab, back to the list) goes through
   leaveEdit(), so unsaved changes in the article editor are never dropped without asking.
   A real article (one with `live`, written by the Content Writer on the server) is decided by the server: the
   actions send the decision and put the server's answer in the store (liveArticleTo). The server records who decided
   (from the session) in the article history and the audit log, so these actions only show the snackbar. The photos of
   a real article (found by the Site Builder on the server) are asked for and removed the same way. */
import { MODES } from '../constants';
import { addLogTo, logMineTo, snackTo } from '../draft';
import { liveArticleTo } from '../liveApply';
import { leaveEdit } from '../editGuard';
import { articleQueued, artReady, artVisible, hhmm, isRev, liveOn, siteById } from '../rules';
import { photosApi } from '../buildsApi';
import { articleApi } from '../serverApi';
import { servicesApi } from '../servicesApi';
import { actor } from '../session';
import type { AppStore } from '../store';
import type { Article, ArticleEditBody, ReviewMode, ServerArticle, Settings } from '../types';
import { NO_SERVER } from './research';
import type { Slice, SliceSet } from './slice';

export type ReviewTab = 'open' | 'done' | 'drafts';
/** The settings the Reports view changes ("Scheduled delivery"). */
export type ReportSettingKey = 'repOn' | 'repTo' | 'repFreq';

export interface ContentState {
  /** Tab of the review list: Waiting, Decided or Drafts. */
  rtab: ReviewTab;
  /** Selected article id. */
  rsel: Article['id'] | null;
  /** On a phone: the detail pane is shown instead of the list. */
  rdetail: boolean;
  /** Message under the decision buttons. */
  rmsg: string;
  /** The review lists also show archived articles. */
  showArchived: boolean;
}

/** What happened to one article of "Approve selected". */
export interface ApproveResult { id: Article['id']; title: string; ok: boolean; /** Why it was skipped. */ why: string }
/** What happened to one keyword of "Write selected". */
export interface SendResult { keyword: string; ok: boolean; /** Why it was not started. */ error: string }

/** Why an article cannot be approved right now, in the words the review screen uses; '' when it can. */
export const NEEDS_LANGUAGE_REVIEW = 'Needs its language review by a native speaker first.';
export const CHECK_FAILED = 'An automated check failed. Fix it by editing the article or request a revision.';
export interface ContentActions {
  /** The prototype's rv-tab: switches the list and clears the selection. */
  setRtab: (t: ReviewTab) => void;
  /** Opens an article in the detail pane (a list click, or a search result). */
  selectArticle: (id: Article['id'], tab?: ReviewTab) => void;
  /**
   * Keeps the stored selection on the article the list shows as selected (the prototype's rvList() writes
   * state.rsel while rendering). With no article to select, the detail pane closes.
   */
  syncReviewSelection: (id: Article['id'] | null) => void;
  /** rv-back: on a phone, return from the detail pane to the list. */
  reviewBack: () => void;
  /** rv-native: records the native-speaker review as done, under the signed-in person's name for a real article. Allowed for a native reviewer. */
  markLanguageReview: (id: Article['id']) => void;
  /** rv-ok: approves and publishes one article. A real article is approved, not published: there is no deploy yet. */
  approveArticle: (id: Article['id']) => void;
  /** rv-rev: sends the article back to the Content Writer with a note. Allowed for a native reviewer. */
  requestRevision: (id: Article['id'], note: string) => void;
  /** rv-no, after the confirm dialog (confirm key "art:<id>"): rejects the article. */
  rejectArticle: (id: Article['id']) => void;
  /** rv-batch: publishes every visible article that passes every check; real ones are approved on the server one by one. */
  approveReady: () => void;
  /**
   * "Write article" on a keyword of a finished research result (live mode): sends it to the Content Writer on the
   * server. Resolves to null when the server accepted it, '' when the role may not do it (the guard showed its
   * snackbar), or the message to show.
   */
  sendArticle: (input: { rid: number; keyword: string }) => Promise<string | null>;
  /**
   * "Write selected" on a finished research result: one article per keyword (at most 10), sent to the server in one
   * call. Resolves to what happened to each keyword, or to the message to show when nothing could be sent ('' when
   * the role may not do it and the guard showed its snackbar).
   */
  sendArticles: (input: { rid: number; keywords: string[] }) => Promise<SendResult[] | string>;
  /**
   * "Approve selected": approves each article that can be approved, one by one on the server, and says for each one
   * that was skipped why. An article with a failed check or without its language review (when Settings require it)
   * is skipped; the others are not held up by it.
   */
  approveSelected: (ids: Article['id'][]) => Promise<ApproveResult[]>;
  /**
   * "Save changes" in the article editor: sends a person's edit of a real article waiting for review. Resolves to
   * null when it was saved, '' when the role may not do it, or the server's message (for example that the article
   * changed meanwhile).
   */
  saveArticleEdit: (id: Article['id'], body: ArticleEditBody) => Promise<string | null>;
  /** "Send back to review" on an approved real article. */
  unapproveArticle: (id: Article['id']) => void;
  /** "Archive" on a decided or failed real article, or "Take out of the archive". */
  archiveArticle: (id: Article['id'], on: boolean) => void;
  /** The "Show archived" switch of the review lists. */
  setShowArchived: (on: boolean) => void;
  /** "Try again" on a real article whose job failed. */
  retryArticle: (id: Article['id']) => void;
  /**
   * "Find photos" (or "Try again" after a failed photo job) on a real article in review or approved: the Site Builder
   * looks for openly licensed photos on the server. The answer shows the job queued.
   */
  findPhotos: (id: Article['id']) => void;
  /** "Remove" on one photo of a real article, after the person confirmed it. */
  removePhoto: (id: Article['id'], photoId: string) => void;
  /** The "Review mode by site" select (data-mode). */
  setSiteReviewMode: (siteId: string, mode: ReviewMode) => void;
  /** A "Scheduled delivery" control (data-set). Returns false when the role may not change settings. */
  setReportSetting: <K extends ReportSettingKey>(key: K, value: Settings[K]) => boolean;
  /** rep-send: sends the weekly report now. Outside demo mode the server emails it (Email (SMTP) in Integrations). */
  sendReport: () => void;
}

/** Why "Send now" and the scheduled email cannot work yet. */
export const NO_EMAIL = 'Set up Email (SMTP) in Integrations to send reports.';

/** Shown when the same site and keyword already have an article queued, being written or waiting for review. */
export const ARTICLE_QUEUED = 'An article for this keyword is already queued, being written or waiting for review for that site.';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);
/** Every automated check passes the hard gate, and the native-speaker review is done when Settings require it. */
const approvable = (settings: Settings, x: Article): boolean => !x.checks.some(c => c[0] === 'bad') && !(settings.native && x.native.st !== 'done');

interface LiveRef { a: Article; aid: number }
/** The article and its server id, when it is a real article. */
function liveOf(s: AppStore, id: Article['id']): LiveRef | null {
  const a = s.articles.find(r => r.id === id);
  return a?.live ? { a, aid: a.live.aid } : null;
}

/**
 * Waits for the server's answer to a decision on a real article. The answer replaces the article and `done` is shown
 * in the snackbar (the server wrote the same sentence to the audit log); a refusal is shown under the decision
 * buttons. `close` returns a phone to the list.
 */
function decideLive(set: SliceSet, call: Promise<ServerArticle>, done: string, close: boolean): void {
  call.then(
    a => set(d => { liveArticleTo(d, a); d.rmsg = ''; if (close) d.rdetail = false; snackTo(d, done); }),
    (e: unknown) => set(d => { d.rmsg = message(e); }),
  );
}

/** Batch approval with real articles in it: sample ones are published here, real ones approved on the server one by one. */
async function approveAll(set: SliceSet, ready: Article[]): Promise<void> {
  let n = 0, err = '';
  for (const x of ready) {
    if (!x.live) {
      set(d => { const y = d.articles.find(r => r.id === x.id); if (y) { y.status = 'published'; y.notes.push('Approved in a batch at ' + hhmm(new Date()) + '.'); } });
      n++; continue;
    }
    try { const a = await articleApi.approve(x.live.aid); set(d => liveArticleTo(d, a)); n++; } catch (e) { err = message(e); }
  }
  set(d => {
    snackTo(d, `Approved ${n} articles at once`);
    if (err) snackTo(d, `${ready.length - n} could not be approved: ${err}`, 'error');
  });
}

export const contentSlice: Slice<ContentState, ContentActions> = {
  initial: { rtab: 'open', rsel: null, rdetail: false, rmsg: '', showArchived: false },
  actions: (set, get) => ({
    setRtab: t => leaveEdit(() => set(d => { d.rtab = t; d.rsel = null; d.rdetail = false; })),
    selectArticle: (id, tab) => {
      const open = () => set(d => { if (tab) d.rtab = tab; d.rsel = id; d.rdetail = true; d.rmsg = ''; });
      /* Selecting the article that is open already takes nothing off the screen. */
      if (get().rsel === id && (!tab || tab === get().rtab)) open(); else leaveEdit(open);
    },
    syncReviewSelection: id => set(d => { d.rsel = id; if (id === null) d.rdetail = false; }),
    reviewBack: () => leaveEdit(() => set(d => { d.rdetail = false; })),
    setShowArchived: on => leaveEdit(() => set(d => { d.showArchived = on; })),

    markLanguageReview: id => {
      if (!get().guard('review')) return;
      const live = liveOf(get(), id);
      if (live) { decideLive(set, articleApi.languageReview(live.aid), 'Finished the language review: ' + live.a.titleEn, false); return; }
      set(d => {
        const x = d.articles.find(r => r.id === id), site = x && siteById(d, x.s); if (!x || !site) return;
        const rev = isRev(d.session);
        const by = rev ? actor(d) : site.cc + ' reviewer';
        x.native = { st: 'done', by, note: rev ? 'Language checked.' : 'Language checked (simulated).' };
        addLogTo(d, by, 'Finished the language review: ' + x.titleEn, x.s);
        if (rev) snackTo(d, 'Language review recorded');
      });
    },

    approveArticle: id => {
      if (!get().guard()) return;
      const live = liveOf(get(), id);
      if (live) {
        if (!approvable(get().settings, live.a)) { set(d => { d.rmsg = 'This article cannot be approved yet.'; }); return; }
        decideLive(set, articleApi.approve(live.aid), 'Approved (not published): ' + live.a.titleEn, true);
        return;
      }
      set(d => {
        const x = d.articles.find(r => r.id === id); if (!x) return;
        if (!approvable(d.settings, x)) { d.rmsg = 'This article cannot be approved yet.'; return; }
        x.status = 'published'; d.rdetail = false; x.notes.push('Approved and published at ' + hhmm(new Date()) + '.'); d.rmsg = '';
        logMineTo(d, 'Approved and published: ' + x.titleEn, x.s);
      });
    },

    requestRevision: (id, note) => {
      if (!get().guard('review')) return;
      const text = note.trim(), live = liveOf(get(), id);
      if (live && text) { decideLive(set, articleApi.revise(live.aid, text), 'Requested a revision: ' + live.a.titleEn, true); return; }
      set(d => {
        const x = d.articles.find(r => r.id === id); if (!x) return;
        if (!text) { d.rmsg = 'Write a revision note first, so the agent knows what to change.'; return; }
        x.status = 'revisi'; x.wait = 50;
        x.notes.push((isRev(d.session) ? actor(d) : 'Reviewer') + ' note: ' + text);
        d.rmsg = ''; d.rdetail = false;
        logMineTo(d, 'Requested a revision: ' + x.titleEn, x.s);
      });
    },

    rejectArticle: id => {
      if (!get().guard()) return;
      const live = liveOf(get(), id);
      if (live) { decideLive(set, articleApi.reject(live.aid), 'Rejected the article: ' + live.a.titleEn, true); return; }
      set(d => {
        const x = d.articles.find(r => r.id === id); if (!x) return;
        x.status = 'rejected'; d.rdetail = false; x.notes.push('Rejected at ' + hhmm(new Date()) + '.'); d.rmsg = '';
        logMineTo(d, 'Rejected the article: ' + x.titleEn, x.s);
      });
    },

    approveReady: () => {
      if (!get().guard()) return;
      const s = get(), ready = s.articles.filter(x => artVisible(s, x) && artReady(s, x));
      if (ready.some(x => x.live)) { void approveAll(set, ready); return; }
      set(d => {
        const r = d.articles.filter(x => artVisible(d, x) && artReady(d, x));
        r.forEach(x => { x.status = 'published'; x.notes.push('Approved in a batch at ' + hhmm(new Date()) + '.'); });
        logMineTo(d, `Approved ${r.length} articles at once`);
      });
    },

    sendArticle: async ({ rid, keyword }) => {
      const s = get();
      if (!s.guard()) return '';
      const r = s.kwReqs.find(x => x.rid === rid);
      if (!liveOn(s) || !r) return NO_SERVER;
      const site = siteById(s, r.site), domain = site?.domain ?? r.domain ?? '';
      if (!domain) return 'This research request has no site.';
      const writer = s.agents.find(a => a.id === 'wr');
      if (!writer) return 'The Content Writer was removed. Add it again in Workspace before sending an article.';
      if (articleQueued(s, r.site, keyword)) return ARTICLE_QUEUED;
      try {
        const a = await articleApi.create({
          siteId: r.site, domain, country: site?.country ?? r.country ?? '', lang: site?.lang ?? r.lang ?? '', siteTopic: site?.topic ?? '',
          keyword, requestId: rid, model: writer.model,
        });
        set(d => { liveArticleTo(d, a); snackTo(d, 'Article sent to the Content Writer.', 'edit_note'); });
        return null;
      } catch (e) { return message(e); }
    },

    sendArticles: async ({ rid, keywords }) => {
      const s = get();
      if (!s.guard()) return '';
      const r = s.kwReqs.find(x => x.rid === rid);
      if (!liveOn(s) || !r) return NO_SERVER;
      const writer = s.agents.find(a => a.id === 'wr');
      if (!writer) return 'The Content Writer was removed. Add it again in Workspace before sending an article.';
      try {
        const { results } = await articleApi.bulk({ requestId: rid, keywords, model: writer.model });
        const n = results.filter(x => x.ok).length;
        set(d => {
          results.forEach(x => { if (x.ok) liveArticleTo(d, x.article); });
          if (n) snackTo(d, n === 1 ? 'Article sent to the Content Writer.' : `${n} articles sent to the Content Writer.`, 'edit_note');
        });
        return results.map(x => ({ keyword: x.keyword, ok: x.ok, error: x.ok ? '' : x.error }));
      } catch (e) { return message(e); }
    },

    approveSelected: async ids => {
      if (!get().guard()) return [];
      const out: ApproveResult[] = [];
      for (const id of ids) {
        const s = get(), x = s.articles.find(r => r.id === id);
        if (!x) continue;
        const skip = (why: string) => out.push({ id, title: x.titleEn, ok: false, why });
        if (x.status !== 'review') { skip('It is not waiting for review any more.'); continue; }
        if (x.checks.some(c => c[0] === 'bad')) { skip(CHECK_FAILED); continue; }
        if (s.settings.native && x.native.st !== 'done') { skip(NEEDS_LANGUAGE_REVIEW); continue; }
        if (!x.live) {
          set(d => { const y = d.articles.find(r => r.id === id); if (y) { y.status = 'published'; y.notes.push('Approved in a batch at ' + hhmm(new Date()) + '.'); } });
          out.push({ id, title: x.titleEn, ok: true, why: '' }); continue;
        }
        /* The server decides again for each one: its refusal (for example a review it requires) is the reason shown. */
        try { const a = await articleApi.approve(x.live.aid); set(d => liveArticleTo(d, a)); out.push({ id, title: x.titleEn, ok: true, why: '' }); }
        catch (e) { skip(message(e)); }
      }
      const n = out.filter(r => r.ok).length;
      if (n) set(d => { snackTo(d, n === 1 ? 'Approved 1 article' : `Approved ${n} articles`); if (out.some(r => r.ok && !d.articles.find(a => a.id === r.id)?.live)) logMineTo(d, `Approved ${n} articles at once`); });
      return out;
    },

    saveArticleEdit: async (id, body) => {
      if (!get().guard()) return '';
      const live = liveOf(get(), id);
      if (!live) return 'Only an article written by the Content Writer can be edited.';
      try {
        const a = await articleApi.edit(live.aid, body);
        set(d => { liveArticleTo(d, a); d.rmsg = ''; snackTo(d, 'Saved your changes: ' + (a.content?.titleEn || a.keyword), 'check'); });
        return null;
      } catch (e) { return message(e); }
    },

    unapproveArticle: id => {
      if (!get().guard()) return;
      const live = liveOf(get(), id);
      /* It moves from Decided to Waiting: the list follows it, so the person sees where it went. */
      if (live) articleApi.unapprove(live.aid).then(
        a => set(d => { liveArticleTo(d, a); d.rmsg = ''; d.rtab = 'open'; d.rsel = id; snackTo(d, 'Sent back to review: ' + live.a.titleEn, 'undo'); }),
        (e: unknown) => set(d => { d.rmsg = message(e); }),
      );
    },

    archiveArticle: (id, on) => {
      if (!get().guard()) return;
      const live = liveOf(get(), id);
      if (live) decideLive(set, on ? articleApi.archive(live.aid) : articleApi.unarchive(live.aid), (on ? 'Archived the article: ' : 'Took the article out of the archive: ') + live.a.titleEn, on);
    },

    retryArticle: id => {
      if (!get().guard()) return;
      const live = liveOf(get(), id);
      if (live) decideLive(set, articleApi.retry(live.aid), 'Asked the Content Writer to try again: ' + live.a.titleEn, false);
    },

    findPhotos: id => {
      if (!get().guard()) return;
      const live = liveOf(get(), id); if (!live) return;
      photosApi.find(live.aid).then(
        a => set(d => { liveArticleTo(d, a); snackTo(d, 'Asked the Site Builder to find photos: ' + live.a.titleEn, 'image_search'); }),
        (e: unknown) => get().snack(message(e), 'error'),
      );
    },

    removePhoto: (id, photoId) => {
      if (!get().guard()) return;
      const live = liveOf(get(), id); if (!live) return;
      photosApi.remove(live.aid, photoId).then(
        a => set(d => { liveArticleTo(d, a); snackTo(d, 'Removed a photo from ' + live.a.titleEn, 'delete'); }),
        (e: unknown) => get().snack(message(e), 'error'),
      );
    },

    setSiteReviewMode: (siteId, mode) => {
      if (!get().guard()) return;
      set(d => {
        const s = siteById(d, siteId); if (!s) return;
        s.mode = mode;
        logMineTo(d, `Review mode for ${s.domain}: ${MODES[mode]}`, s.id);
      });
    },

    setReportSetting: (key, value) => {
      if (!get().guard()) return false;
      set(d => { d.settings[key] = value; logMineTo(d, 'Updated settings'); });
      return true;
    },

    sendReport: () => {
      if (!get().guard()) return;
      if (!get().sample) {
        /* The server writes the audit entry under the signed-in person. */
        servicesApi.sendReport().then(
          r => get().snack('Report sent to ' + r.to.join(', '), 'send'),
          (e: unknown) => get().snack(e instanceof Error ? e.message : String(e), 'error'),
        );
        return;
      }
      const to = get().settings.repTo;
      if (!to.trim()) { get().snack('Add at least one recipient first.', 'info'); return; }
      set(d => logMineTo(d, 'Sent the weekly report to ' + to + ' (simulated)'));
    },
  }),
};

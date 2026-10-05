import { useEffect, useState } from 'react';
import { OperationScene } from './visual/OperationScene';
import { Button, Callout, Checkbox, cx, Empty, ModTable, Pill, SiteChip, Switch, Tabs } from '@/components';
import { go } from '@/nav';
import { AST } from '@/store/constants';
import { useEditGuard } from '@/store/editGuard';
import { artOpen, artReady, artVisible, inSite, isRev, siteById } from '@/store/rules';
import type { ApproveResult, ReviewTab } from '@/store/slices/content';
import { useStore, useStoreShallow } from '@/store/store';
import type { Article } from '@/store/types';
import { ArticleDetail } from './content/ArticleDetail';
import { ReviewModes } from './content/ReviewModes';
import './content/review.css';

/**
 * Article review: list-detail review queue, drafts, review mode by site. Prototype: vReview() and helpers, lines 1391-1433.
 * Several waiting articles can be ticked and approved in one go ("Approve selected"); archived articles are hidden
 * until "Show archived" is on.
 */
export function Review() {
  const [articles, sites, siteFilter, settings, session, mod, sample] = useStoreShallow(s => [s.articles, s.sites, s.siteFilter, s.settings, s.session, s.mod, s.sample] as const);
  const [rtab, rsel, rdetail, showArchived] = useStoreShallow(s => [s.rtab, s.rsel, s.rdetail, s.showArchived] as const);
  const setRtab = useStore(s => s.setRtab);
  const syncReviewSelection = useStore(s => s.syncReviewSelection);
  const approveReady = useStore(s => s.approveReady);
  const approveSelected = useStore(s => s.approveSelected);
  const setShowArchived = useStore(s => s.setShowArchived);
  const editing = useEditGuard().id;
  /* Ticked for "Approve selected", and what the last run did. */
  const [picked, setPicked] = useState<readonly Article['id'][]>([]);
  const [approving, setApproving] = useState(false);
  const [results, setResults] = useState<ApproveResult[] | null>(null);

  const rev = isRev(session);
  /* A native reviewer has no Drafts tab. Outside demo mode nobody has: an article being written is under Waiting. */
  const noDrafts = rev || !sample;
  const tab: ReviewTab = noDrafts && rtab === 'drafts' ? 'open' : rtab;
  const visible = articles.filter(a => artVisible({ sites, siteFilter }, a));
  const shown = visible.filter(a => showArchived || !a.archived);
  const inTab = (a: Article) => tab === 'open' ? artOpen(a) : !artOpen(a);
  const list = shown.filter(inTab);
  const archivedHere = visible.filter(a => a.archived && inTab(a)).length;
  /* rvList(): keep the selection while it is in the list, otherwise select the first article. The article open in
     the editor stays selected whatever happens to the list: its unsaved changes must not vanish with it. */
  const pinned = editing !== null && articles.some(a => a.id === editing) ? editing : null;
  const selId = pinned ?? (list.some(a => a.id === rsel) ? rsel : list[0]?.id ?? null);
  const sel = articles.find(a => a.id === selId);
  const ready = visible.filter(a => artReady({ settings }, a)).length;
  const drafts = mod.content.rows.filter(r => siteById({ sites }, r.s) && inSite({ siteFilter }, r.s)).length;
  /* Only what waits for a decision can be ticked, and only what is still listed counts. */
  const pickable = tab === 'open' && !rev ? list.filter(a => a.status === 'review') : [];
  const chosen = pickable.filter(a => picked.includes(a.id)).map(a => a.id);

  useEffect(() => { if (tab !== 'drafts' && selId !== rsel) syncReviewSelection(selId); }, [tab, selId, rsel, syncReviewSelection]);

  const tabs: { id: ReviewTab; label: string }[] = [
    { id: 'open', label: `Waiting (${shown.filter(artOpen).length})` },
    { id: 'done', label: `Decided (${shown.filter(a => !artOpen(a)).length})` },
  ];
  if (!noDrafts) tabs.push({ id: 'drafts', label: `Drafts (${drafts})` });

  const toggle = (id: Article['id']) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const approve = async () => {
    setApproving(true);
    const r = await approveSelected(chosen);
    setApproving(false); setPicked([]);
    if (r.length) setResults(r);
  };

  return (
    <>
      <OperationScene kind="review" />
      <div className="sh">
        <Tabs value={tab} onChange={setRtab} items={tabs} />
        <span className="grow" />
        {tab !== 'drafts' && (archivedHere || showArchived) ? <label className="rv-arch"><Switch checked={showArchived} onChange={setShowArchived} /><span>Show archived{archivedHere ? ` (${archivedHere})` : ''}</span></label> : null}
        {chosen.length ? (
          <>
            <Button variant="text" onClick={() => setPicked([])}>Clear</Button>
            <Button variant="filled" icon="done_all" disabled={approving} onClick={() => { void approve(); }}>{approving ? 'Approving…' : `Approve selected (${chosen.length})`}</Button>
          </>
        ) : tab === 'open' && ready > 1 && !rev ? <Button variant="tonal" icon="done_all" onClick={approveReady}>Approve {ready} that pass every check</Button> : null}
      </div>
      {results ? <ApproveResults results={results} onClose={() => setResults(null)} /> : null}
      {tab === 'drafts' ? (
        <section><p className="note">{mod.content.d}</p><ModTable id="content" /></section>
      ) : !articles.length ? (
        <Empty icon="rate_review" title="No articles to review yet"
          action={rev ? undefined : sites.length
            ? <Button variant="tonal" icon="key" onClick={() => go('keywords')}>Open Keywords</Button>
            : <Button variant="tonal" icon="language" onClick={() => go('sites')}>Add your first domain</Button>}>
          An article is listed here when the Content Writer finishes it, and nothing publishes before a person approves it.{rev ? '' : ' To start one, choose “Write article” on a keyword.'}
        </Empty>
      ) : !list.length && !pinned ? (
        /* One full-width empty state instead of an empty list beside an empty detail pane (B12). */
        <Empty icon={tab === 'open' ? 'task_alt' : 'inventory_2'} title={tab === 'open' ? 'Nothing is waiting' : 'Nothing decided yet'}>
          {tab === 'open' ? 'Every article in this list has been decided.' : 'Approved and rejected articles are kept here.'}
          {archivedHere && !showArchived ? ` ${archivedHere} archived ${archivedHere === 1 ? 'article is' : 'articles are'} hidden: turn on “Show archived” to see ${archivedHere === 1 ? 'it' : 'them'}.` : ''}
        </Empty>
      ) : (
        <div className="rv" data-detail={rdetail && sel ? 1 : 0}>
          <div className="rvlist" id="rvlist">
            {pickable.length > 1 ? (
              <label className="rv-all">
                <input type="checkbox" checked={chosen.length === pickable.length} ref={el => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < pickable.length; }}
                  onChange={e => setPicked(e.target.checked ? pickable.map(a => a.id) : [])} />
                Select all {pickable.length} waiting for review
              </label>
            ) : null}
            <ArticleList list={list} selId={selId} pickable={pickable} picked={chosen} onPick={toggle} />
          </div>
          <ArticleDetail key={sel?.id} a={sel} />
        </div>
      )}
      {/* Review modes drive the demo simulation only; the server sends every article to a person. */}
      {rev || !sample ? null : <ReviewModes />}
    </>
  );
}

/** What "Approve selected" did: how many were approved, and for each one that was skipped, why. */
function ApproveResults({ results, onClose }: { results: ApproveResult[]; onClose: () => void }) {
  const ok = results.filter(r => r.ok).length, skipped = results.filter(r => !r.ok);
  if (!skipped.length) return null;
  return (
    <div className="rv-res" role="status">
      <Callout icon="rule" warn>
        <b>Approved {ok} of {results.length}.</b> {skipped.length === 1 ? '1 article was skipped and still waits for review:' : `${skipped.length} articles were skipped and still wait for review:`}
      </Callout>
      <ul className="checks">{skipped.map(r => <li key={r.id}><Pill kind="warn">Skipped</Pill><span><b>{r.title}</b>: {r.why}</span></li>)}</ul>
      <div className="row"><Button size="sm" variant="text" onClick={onClose}>Dismiss</Button></div>
    </div>
  );
}

/** The prototype's rvListHTML(list). An article that waits for a decision has a tick box for "Approve selected". */
function ArticleList({ list, selId, pickable, picked, onPick }: {
  list: Article[]; selId: Article['id'] | null; pickable: readonly Article[]; picked: readonly Article['id'][]; onPick: (id: Article['id']) => void;
}) {
  const settings = useStore(s => s.settings);
  const selectArticle = useStore(s => s.selectArticle);
  if (!list.length) return <Empty>No articles in this list.</Empty>;
  return list.map(a => {
    const row = (
      <button type="button" key={a.id} className={cx('art', a.id === selId && 'on')} data-art={a.id} onClick={() => selectArticle(a.id)}>
        <b>{a.titleEn}</b>
        <SiteChip id={a.s} domain={a.live?.domain} />
        <span className="row">
          <Pill kind={AST[a.status][0]} live={a.status === 'revisi' || a.status === 'writing'}>{AST[a.status][1]}</Pill>
          {artReady({ settings }, a) ? <Pill kind="ok">All checks pass</Pill> : null}
          {a.archived ? <Pill kind="mut">Archived</Pill> : null}
        </span>
      </button>
    );
    if (!pickable.length) return row;
    /* The tick box sits beside the row, not inside it: a button cannot hold another control. */
    return (
      <div key={a.id} className={cx('rv-pick', picked.includes(a.id) && 'on')}>
        {pickable.includes(a) ? <Checkbox label={'Select: ' + a.titleEn} checked={picked.includes(a.id)} onChange={() => onPick(a.id)} /> : <span className="ck" aria-hidden="true" />}
        {row}
      </div>
    );
  });
}

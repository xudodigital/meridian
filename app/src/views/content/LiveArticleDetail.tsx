import { useCallback, useId, useState } from 'react';
import { Button, Callout, Dialog, Pill, SheetActions, Tag } from '@/components';
import { articlePlace } from '@/store/builds';
import { AST } from '@/store/constants';
import { dayTime, isRev, siteById } from '@/store/rules';
import { HELD_LABEL, heldFor } from '@/store/spend';
import { useStore } from '@/store/store';
import type { Article, LiveArticle } from '@/store/types';
import { LiveLink, filesKept } from '../deploy/parts';
import { Decide } from './ArticleReview';
import { ArticleEditor } from './ArticleEditor';
import { ArticleHistory } from './ArticleHistory';
import { LiveArticleBody } from './LiveArticleBody';

/** Admins and editors edit, send back and archive; the server refuses everyone else. */
const useMayWrite = (): boolean => useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');

/**
 * A real article written by the Content Writer on the server. While it is written or revised it shows the step it is
 * on; when the job failed it shows the error and "Try again"; once written it shows the whole article for review.
 * An admin or editor can edit an article that waits for review ("Edit"): the editor takes the place of the article
 * and the decision box until the changes are saved or cancelled.
 */
export function LiveArticleDetail({ a, live }: { a: Article; live: LiveArticle }) {
  const site = useStore(s => siteById(s, a.s));
  const srv = useStore(s => s.live.arts[live.aid]);
  const reviewBack = useStore(s => s.reviewBack);
  const mayWrite = useMayWrite();
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => setEditing(false), []);
  const [kind, label] = AST[a.status];
  const busy = a.status === 'writing' || a.status === 'revisi';
  const canEdit = mayWrite && a.status === 'review' && !!live.content && !!srv?.content;
  /* The editor stays open on the version it has when the article changes under it (it says so and cannot save). */
  const edit = editing && !!srv?.content && !busy && a.status !== 'failed';
  return (
    <div className="rvd">
      <Button variant="text" icon="arrow_back" className="rvback" onClick={reviewBack}>Back to list</Button>
      <div className="rvhead">
        <div><h2>{a.title}</h2><p className="lede">{a.titleEn}</p></div>
        {edit ? <Pill kind="info">Editing</Pill>
          : canEdit ? <Button variant="tonal" icon="edit" onClick={() => setEditing(true)}>Edit</Button> : null}
      </div>
      <div className="tags">
        <Tag icon="language">{site ? site.cc + ' · ' + site.domain : live.domain}</Tag>
        <Tag icon="translate">{live.lang}</Tag>
        <Tag icon="key">{a.kw}</Tag>
        <Tag icon="history">Revision {a.rev}</Tag>
        {live.engine === 'gemma-local' ? <Tag icon="smart_toy">Gemma localhost</Tag> : live.engine === 'codex-local' ? <Tag icon="smart_toy">Codex local</Tag> : live.engine === 'openai-api' ? <Tag icon="smart_toy">OpenAI</Tag> : null}
        <Pill kind={kind} live={busy}>{label}</Pill>
        {a.archived ? <Pill kind="mut">Archived</Pill> : null}
      </div>
      {busy ? <InProgress a={a} live={live} /> : a.status === 'failed' ? <Failed a={a} live={live} />
        : edit && srv ? <ArticleEditor a={a} live={live} srv={srv} onDone={closeEditor} /> : <LiveArticleBody a={a} live={live} />}
      <ArticleHistory events={live.history} />
      {a.status === 'review' && !edit ? <Decide a={a} /> : null}
      {a.status === 'approved' ? <OnTheSite a={a} live={live} /> : null}
      {edit ? null : <AfterDecision a={a} />}
    </div>
  );
}

/**
 * What can still be done once an article is decided (or failed): send an approved one back to review, and archive
 * it or take it out of the archive. For admins and editors.
 */
function AfterDecision({ a }: { a: Article }) {
  const mayWrite = useMayWrite();
  const unapproveArticle = useStore(s => s.unapproveArticle);
  const archiveArticle = useStore(s => s.archiveArticle);
  const rmsg = useStore(s => s.rmsg);
  const [asking, setAsking] = useState(false);
  const titleId = useId();
  const decided = a.status === 'approved' || a.status === 'rejected' || a.status === 'failed';
  if (!mayWrite || !decided) return null;
  return (
    <section className="after">
      <div className="row">
        {a.status === 'approved' ? <Button variant="tonal" icon="undo" onClick={() => setAsking(true)}>Send back to review</Button> : null}
        {a.archived
          ? <Button variant="outlined" icon="unarchive" onClick={() => archiveArticle(a.id, false)}>Take out of the archive</Button>
          : <Button variant="text" icon="archive" onClick={() => archiveArticle(a.id, true)}>Archive</Button>}
      </div>
      <p className="note">
        {a.status === 'approved' ? 'To change an approved article, send it back to review: there it can be edited and approved again. ' : ''}
        {a.archived ? 'This article is archived: the lists show it only with “Show archived” on.'
          : a.status === 'approved' ? 'Archiving only hides it from this list. It stays approved and stays part of the website.'
            : 'Archiving hides it from this list. Nothing is deleted.'}
      </p>
      {rmsg && a.status !== 'failed' ? <p className="err" role="alert">{rmsg}</p> : null}
      <Dialog open={asking} onClose={() => setAsking(false)} labelledBy={titleId} className="ed-ask">
        <h2 id={titleId}>Send this article back to review?</h2>
        <p>It returns to Waiting, where it can be edited and approved again. The next website build of its site leaves it out until then.</p>
        <p>A build that is already live is not changed: the article stays on the site until a new build is deployed.</p>
        <SheetActions>
          <Button variant="text" onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="filled" icon="undo" onClick={() => { setAsking(false); unapproveArticle(a.id); }}>Send back to review</Button>
        </SheetActions>
      </Dialog>
    </section>
  );
}

/**
 * Where an approved article is on its way to the site, from the site's website builds (Build and deploy). Native
 * reviewers do not see builds, so they are told only who puts the article on the site.
 */
function OnTheSite({ a, live }: { a: Article; live: LiveArticle }) {
  const builds = useStore(s => s.live.builds);
  const rev = useStore(s => isRev(s.session));
  const askFirst = useStore(s => s.settings.apDeploy);
  if (rev) return <Callout icon="verified" info><b>Approved.</b> An editor or admin puts it on the site with a website build.</Callout>;
  const p = articlePlace(builds, a.s, live.aid);
  if (p.at === 'next') {
    return (
      <Callout icon="verified" info>
        <b>Approved, not published yet.</b> {askFirst
          ? 'It goes on the site with the next website build, once that build is approved in Build and deploy.'
          : 'It goes on the site with the next website build. “Require approval before a deploy” is off in Settings, so that build is approved by itself and goes live as soon as it is built when Cloudflare is connected.'}
      </Callout>
    );
  }
  const v = `v${p.b.version} of ${p.b.domain}`;
  if (p.at === 'live') return <Callout icon="public" info><b>Live on the site.</b> It is in {v}, live since {dayTime(p.b.deployedAt ?? p.b.updatedAt)}. <LiveLink b={p.b} /></Callout>;
  if (p.at === 'deploying') return <Callout icon="rocket_launch" info><b>Going live.</b> It is in {v}, which is being put live on Cloudflare Pages now.</Callout>;
  if (p.at === 'approved') {
    return (
      <Callout icon="verified" info>
        <b>Approved, not live yet.</b> It is in {v}, which is approved {!filesKept(p.b)
          ? 'but its files were removed to save space. Build the website again in Build and deploy.'
          : p.b.deploy === 'failed' ? 'but its deploy failed. Try the deploy again in Build and deploy, or download its ZIP for any static host.'
            : 'but not deployed. Deploy it in Build and deploy, or download its ZIP for any static host.'}
      </Callout>
    );
  }
  return <Callout icon="verified" info><b>Approved, not published yet.</b> It is in {v}, a website build that waits for approval in Build and deploy.</Callout>;
}

/** Queued, being written, or being revised: where the job is. Nothing can be decided yet. */
function InProgress({ a, live }: { a: Article; live: LiveArticle }) {
  const queued = live.state === 'queued' || live.state === 'revision';
  /* The server holds a waiting job of a site that used its daily budget (store/spend.ts). */
  const held = useStore(s => queued ? heldFor(s, a.s, live.domain) : null);
  return (
    <section>
      <h3>Status</h3>
      <p>{queued ? (held ? `${HELD_LABEL}. ${held}` : 'Waiting in the queue. Agent jobs run one at a time, oldest first.') : live.step || 'Starting'}</p>
      {live.pendingNote ? <p className="note">Revision note: {live.pendingNote}</p> : null}
      <p className="note">
        {a.status === 'revisi'
          ? 'The Content Writer is rewriting the article from the note. It returns to this queue when it is done.'
          : 'The Content Writer is writing this article. It is listed here for review when it is done; writing takes several minutes.'}
      </p>
    </section>
  );
}

/** The job stopped: the error and "Try again". */
function Failed({ a, live }: { a: Article; live: LiveArticle }) {
  const retryArticle = useStore(s => s.retryArticle);
  const rmsg = useStore(s => s.rmsg);
  return (
    <section>
      <h3>What went wrong</h3>
      <Callout icon="error" warn>{live.error || 'The job stopped without a message.'}</Callout>
      <div className="row"><Button variant="tonal" icon="refresh" onClick={() => retryArticle(a.id)}>Try again</Button></div>
      {rmsg ? <p className="err">{rmsg}</p> : null}
    </section>
  );
}

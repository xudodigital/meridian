/* The parts of the review pane shared by sample and real articles: checks, native-speaker review and the decision box. */
import { useState } from 'react';
import { Button, Field, Pill } from '@/components';
import { isRev } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Article } from '@/store/types';

/** The automated checks: computed by the server for a real article, part of the sample data otherwise. */
export function Checks({ a }: { a: Article }) {
  return (
    <section>
      <h3>Automated checks</h3>
      <ul className="checks">{a.checks.map((c, i) => <li key={i}><Pill kind={c[0]}>{c[1]}</Pill><span>{c[2]}</span></li>)}</ul>
    </section>
  );
}

/** The native-speaker review. On a real article the button records the signed-in person; on a sample article it is simulated. */
export function NativeReview({ a }: { a: Article }) {
  const rev = useStore(s => isRev(s.session));
  const markLanguageReview = useStore(s => s.markLanguageReview);
  return (
    <section>
      <h3>Native-speaker review</h3>
      {a.native.st === 'done' ? (
        /* The prototype puts this <li> straight inside a div.checks; kept for the same styling. */
        <div className="checks"><li><Pill kind="ok">Done</Pill><span>{a.native.by}: {a.native.note}</span></li></div>
      ) : (
        <div className="row">
          <Pill kind="warn">Not reviewed yet</Pill>
          {rev ? null : <Button size="sm" variant="tonal" onClick={() => markLanguageReview(a.id)}>{a.live ? 'Mark as done' : 'Mark as done (simulated)'}</Button>}
        </div>
      )}
    </section>
  );
}

/**
 * The decision box of an article waiting for review. A native reviewer gets the language review and revision only.
 * A real article is approved, not published: it is published by the next website build of its site (Build and deploy).
 */
export function Decide({ a }: { a: Article }) {
  const rev = useStore(s => isRev(s.session));
  const native = useStore(s => s.settings.native);
  const askFirst = useStore(s => s.settings.apDeploy);
  const rmsg = useStore(s => s.rmsg);
  const markLanguageReview = useStore(s => s.markLanguageReview);
  const approveArticle = useStore(s => s.approveArticle);
  const requestRevision = useStore(s => s.requestRevision);
  const openConfirm = useStore(s => s.openConfirm);
  const [note, setNote] = useState('');

  const done = a.native.st === 'done';
  const needNative = native && !done, failed = a.checks.some(c => c[0] === 'bad');
  const revise = <Button variant="tonal" onClick={() => requestRevision(a.id, note)}>Request revision</Button>;

  return (
    <div className="decide">
      <Field label="Note for the agent (required to request a revision)">
        <textarea id="rvNote" rows={2} placeholder="For example: remove the testing claim and cite the official spec sheet instead." value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      {rev ? (
        <>
          <div className="row">
            {done ? null : <Button variant="filled" icon="check" onClick={() => markLanguageReview(a.id)}>Mark language review as done</Button>}
            {revise}
          </div>
          <p className="note">{done ? 'The language review is done. An editor or admin decides whether the article is published.' : 'Your role reviews the language. Publishing is decided by an editor or admin.'}</p>
        </>
      ) : (
        <>
          <div className="row">
            <Button variant="filled" className="approve" icon="check" disabled={needNative || failed} onClick={() => approveArticle(a.id)}>{a.live ? 'Approve' : 'Approve and publish'}</Button>
            {revise}
            <Button variant="danger" onClick={() => openConfirm(`art:${a.id}`)}>Reject</Button>
          </div>
          {a.live ? (
            <p className="note">
              Approving does not publish the article by itself: it goes into the next website build of its site, {askFirst
                ? 'which is approved again before it goes live.'
                : 'and “Require approval before a deploy” is off in Settings, so that build goes live as soon as it is built when Cloudflare is connected, without a second approval.'}
            </p>
          ) : null}
          {failed ? <p className="note">Cannot approve: an automated check failed. Request a revision or reject the article.</p> : null}
        </>
      )}
      {needNative && !rev && !failed ? (
        <div className="row">
          <p className="note">Approve unlocks after the native-speaker review. Read the article in its own language, then mark the review as done.</p>
          <Button size="sm" variant="tonal" icon="translate" onClick={() => markLanguageReview(a.id)}>{a.live ? 'Mark language review as done' : 'Mark language review as done (simulated)'}</Button>
        </div>
      ) : null}
      {rmsg ? <p className="err">{rmsg}</p> : null}
    </div>
  );
}

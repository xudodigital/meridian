/* One workflow run on the Workflows tab: which step it is on, since when, what it waits for (with links to the
   articles or the build a person must decide), and what each step did. Outside demo mode only. */
import { useId, useState } from 'react';
import { Button, Dialog, Icon, LinkButton, Pill, SheetActions, SiteChip } from '@/components';
import { go } from '@/nav';
import { FLOW, stepStates } from '@/store/liveWorkflows';
import { stamp } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { AliasId, PillKind, ViewId, WorkflowWait, WorkflowWire } from '@/store/types';
import { mayWrite, PreviewLink, useOneAtATime } from '../deploy/parts';
import { closeJourney, openJourney } from '../journey/state';
import './workflows.css';

const openView = (view: ViewId | AliasId) => { closeJourney(); go(view); };

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The pill that says, in two words, whether anything is moving. */
function statusPill(r: WorkflowWire): { kind: PillKind; text: string; live?: boolean } {
  if (r.status === 'done') return { kind: 'ok', text: 'Done' };
  if (r.status === 'failed') return { kind: 'bad', text: 'Failed' };
  if (r.status === 'cancelled') return { kind: 'mut', text: 'Cancelled' };
  switch (r.wait?.kind) {
    case 'person': return { kind: 'warn', text: 'Waiting for you' };
    case 'budget': return { kind: 'warn', text: 'Waiting for budget' };
    case 'queue': return { kind: 'mut', text: 'Waiting for the queue' };
    default: return { kind: 'info', text: 'Running', live: true };
  }
}
const WAIT_ICON: Readonly<Record<WorkflowWait['kind'], string>> = { agent: 'smart_toy', person: 'person_alert', budget: 'savings', queue: 'hourglass_top' };
/** Where the work of each step is, for the "Open" button. */
const STEP_VIEW: Readonly<Record<string, readonly [ViewId | AliasId, string]>> = {
  research: ['keywords', 'Open Keywords'], write: ['review', 'Open Article review'], review: ['review', 'Open Article review'],
  build: ['website', 'Open the Website tab'], approve: ['website', 'Open the Website tab'], deploy: ['website', 'Open the Website tab'],
};

/** What a running workflow waits for, with the things a person can open to move it on. */
function Now({ run }: { run: WorkflowWire }) {
  const [arts, builds, admin] = useStoreShallow(s => [s.live.arts, s.live.builds, s.session?.role === 'admin'] as const);
  const selectArticle = useStore(s => s.selectArticle);
  const w = run.wait;
  const kind = w?.kind ?? 'agent';
  const waiting = run.step === 'review' ? run.articles.map(id => arts[id]).filter(a => a?.status === 'review') : [];
  const build = run.buildId !== null ? builds[run.buildId] : undefined;
  const [view, label] = STEP_VIEW[run.step] ?? ['website', 'Open the Website tab'];
  return (
    <div className="wf-now" data-k={kind}>
      <Icon name={WAIT_ICON[kind]} />
      <div className="wf-now-text">
        <b>{w?.text ?? 'Starting'}</b>
        <span className="note">{w?.detail ? w.detail + ' ' : ''}On this step since {stamp(run.stepAt)}.</span>
      </div>
      <div className="wf-links">
        {run.step === 'approve' && build ? <PreviewLink b={build} /> : null}
        {kind === 'budget' && admin ? <Button size="sm" variant="text" onClick={() => openView('settings')}>Open Settings</Button> : null}
        <Button size="sm" variant="tonal" onClick={() => openView(view)}>{label}</Button>
      </div>
      {waiting.length ? (
        <ul className="wf-waits" aria-label="Articles waiting for your review">
          {waiting.map(a => a ? (
            <li key={a.id}>
              <Icon name="article" />
              <LinkButton title="Open this article in Article review" onClick={() => { selectArticle('a' + a.id, 'open'); openView('review'); }}>{a.content?.titleEn || a.content?.title || a.keyword}</LinkButton>
            </li>
          ) : null)}
        </ul>
      ) : null}
    </div>
  );
}

/** How a run ended. */
function Ended({ run }: { run: WorkflowWire }) {
  const failed = run.status === 'failed';
  return (
    <div className="wf-now" data-k={failed ? 'failed' : run.status === 'done' ? 'done' : 'queue'}>
      <Icon name={failed ? 'error' : run.status === 'done' ? 'task_alt' : 'cancel'} />
      <div className="wf-now-text">
        <b>{failed ? run.error || 'Stopped' : run.outcome || (run.status === 'done' ? 'Finished' : 'Cancelled')}</b>
        <span className="note">{failed ? 'Stopped' : 'Ended'} {stamp(run.finishedAt ?? run.updatedAt)}.{failed ? ' Fix the cause, then run the workflow again.' : ''}</span>
      </div>
    </div>
  );
}

export function RunCard({ run, detail = false }: { run: WorkflowWire; detail?: boolean }) {
  const write = useStore(mayWrite);
  const cancelWorkflow = useStore(s => s.cancelWorkflow);
  const [busy, once] = useOneAtATime();
  const [asking, setAsking] = useState(false);
  const askId = useId();
  const states = stepStates(run), pill = statusPill(run), running = run.status === 'running';
  return (
    <article className="wf-run" data-st={run.status} aria-label={`${run.name} for ${run.domain}`}>
      <header className="wf-head">
        <div className="wf-name">
          <span className="wf-title"><b>{run.name}</b><SiteChip id={run.siteId} domain={run.domain} /></span>
          <span className="note">
            Started {stamp(run.createdAt)} by {run.by === 'Schedule' ? 'its schedule' : run.by || 'a person'} · up to {plural(run.n, 'article')}{run.topic ? ` · topic: ${run.topic}` : ''}
          </span>
        </div>
        <Pill kind={pill.kind} live={pill.live}>{pill.text}</Pill>
        {!detail ? <Button size="sm" variant="text" icon="route" onClick={() => openJourney({kind:"workflow", id:String(run.id)})}>View journey</Button> : null}
        {running && write ? <Button size="sm" variant="text" icon="cancel" disabled={busy} aria-label={`Cancel ${run.name} for ${run.domain}`} onClick={() => setAsking(true)}>Cancel</Button> : null}
      </header>
      <ol className="wf-steps" aria-label="Steps">
        {FLOW.map((f, i) => {
          const s = states[i]!;
          return (
            <li key={f.id} data-s={s} data-k={s === 'now' ? run.wait?.kind ?? 'agent' : undefined} aria-current={s === 'now' ? 'step' : undefined}>
              <span className="wf-dot"><Icon name={s === 'done' ? 'check' : s === 'failed' ? 'close' : f.icon} /></span>
              <span className="wf-lbl">{f.label}<span className="wf-sr">{s === 'done' ? ' (done)' : s === 'now' ? ' (now)' : s === 'failed' ? ' (failed here)' : s === 'stopped' ? ' (stopped here)' : ' (not reached)'}</span></span>
              <span className="wf-who">{f.who}</span>
            </li>
          );
        })}
      </ol>
      {running ? <Now run={run} /> : <Ended run={run} />}
      <details className="wf-log">
        <summary><Icon name="chevron_right" />What it did ({plural(run.log.length, 'entry').replace('entrys', 'entries')})</summary>
        <ol>{run.log.map((l, i) => <li key={i}><time>{stamp(l.at)}</time><span>{l.text}</span></li>)}</ol>
      </details>
      <Dialog open={asking} onClose={() => setAsking(false)} className="wf-ask" labelledBy={askId}>
        <h2 id={askId}>Cancel this workflow?</h2>
        <p>{run.name} for {run.domain} stops here. Jobs it queued that have not started are withdrawn. A job that is running now finishes, and articles already written stay in Article review.</p>
        <SheetActions>
          <Button variant="text" onClick={() => setAsking(false)}>Keep it running</Button>
          <Button variant="danger" disabled={busy} onClick={() => { setAsking(false); void once(() => cancelWorkflow(run.id)); }}>Cancel workflow</Button>
        </SheetActions>
      </Dialog>
    </article>
  );
}

import { Button, Pill, Sheet, SheetActions, Tag } from '@/components';
import { engineName, showCosts, fmt, fmtDur, siteById } from '@/store/rules';
import { useStore } from '@/store/store';
import type { JobRun } from '@/store/types';

/** The prototype's openRun() (lines 1967-1974): one run with its facts and a step-by-step log. */
export function RunSheet({ run, onClose }: { run: JobRun | null; onClose: () => void }) {
  return (
    <Sheet open={run !== null} onClose={onClose} title={run?.task}>
      {run ? <RunLog r={run} /> : null}
      <SheetActions><Button variant="text" onClick={onClose}>Close</Button></SheetActions>
    </Sheet>
  );
}

/**
 * When each step began, as "+1m 05s". A real job has the times the server recorded; a sample run (demo mode) spreads its
 * duration evenly, as the prototype did; a real job from before times were recorded shows none.
 */
export function stepTimes(r: Pick<JobRun, 'steps' | 'stepAt' | 'dur'>, sample: boolean): (string | null)[] {
  if (r.stepAt && r.stepAt.length === r.steps.length) return r.stepAt.map(t => '+' + fmtDur(t));
  if (!sample) return r.steps.map(() => null);
  const per = Math.max(1, Math.round(r.dur / r.steps.length));
  return r.steps.map((_, i) => '+' + fmtDur(i * per));
}

function RunLog({ r }: { r: JobRun }) {
  const site = useStore(s => siteById(s, r.site));
  /* The closing line of a failed run is a sample sentence; a real failed run already ends with its own error. */
  const sample = useStore(s => s.sample);
  const costs = useStore(showCosts);
  const times = stepTimes(r, sample);
  return (
    <>
      <div className="tags" style={{ marginTop: 12 }}>
        <Tag icon="smart_toy">{r.agent}</Tag>
        {r.by ? <Tag icon="person">Asked by {r.by}</Tag> : null}
        {site || r.domain ? <Tag icon="language">{site ? site.domain : r.domain}</Tag> : null}
        <Tag icon="timer">{fmtDur(r.dur)}</Tag>
        <Tag icon="toll">{fmt(r.tokens)} tokens</Tag>
        {r.engine ? <Tag icon="smart_toy">{engineName(r.engine)}</Tag> : null}
        {costs && r.engine !== 'codex-local' && r.engine !== 'gemma-local' ? <Tag icon="payments">{'$' + r.cost.toFixed(2)}</Tag> : null}
        <Pill kind={r.status === 'Done' ? 'ok' : 'bad'}>{r.status}</Pill>
      </div>
      <div className="dsec">
        <h3>Steps</h3>
        <ol className="tl">
          {r.steps.map((x, i) => <li key={i}><time>{times[i] ?? ''}</time><i /><span>{x}</span></li>)}
          {r.status === 'Failed' && sample ? (
            <li><time>+{fmtDur(r.dur)}</time><i style={{ background: 'var(--md-sys-color-error)' }} /><span className="err">Stopped: the tool returned a rate-limit error. The run will retry.</span></li>
          ) : null}
        </ol>
      </div>
    </>
  );
}

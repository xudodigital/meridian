/* The Workspace's line per running workflow, above the content pipeline: which workflow, for which site, the step it is
   on and what it waits for. A click opens the Workflows tab. Outside demo mode only (demo mode has no real runs). */
import { Icon, Pill } from '@/components';
import { go } from '@/nav';
import { FLOW, runningShown } from '@/store/liveWorkflows';
import { useStoreShallow } from '@/store/store';
import './workflows.css';

export function WorkspaceRuns() {
  const runs = useStoreShallow(s => s.sample ? [] : runningShown(s));
  if (!runs.length) return null;
  return (
    <div className="wf-strip" id="ws-workflows" aria-label="Running workflows">
      {runs.map(r => {
        const step = FLOW.find(f => f.id === r.step), person = r.wait?.kind === 'person', held = r.wait?.kind === 'budget';
        return (
          <button type="button" className="wf-line" key={r.id} onClick={() => go('workflows')} aria-label={`${r.name} for ${r.domain}: ${r.wait?.text ?? step?.label ?? 'running'}. Open Workflows`}>
            <Icon name="account_tree" />
            <span className="wf-line-text"><b>{r.name}</b> for {r.domain}<span className="note">Step {FLOW.findIndex(f => f.id === r.step) + 1} of {FLOW.length}: {step?.label ?? r.step} · {r.wait?.text ?? 'Starting'}</span></span>
            <Pill kind={person || held ? 'warn' : 'info'} live={!person && !held}>{person ? 'Waiting for you' : held ? 'Waiting for budget' : 'Running'}</Pill>
          </button>
        );
      })}
    </div>
  );
}

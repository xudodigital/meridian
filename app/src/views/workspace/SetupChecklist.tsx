import { useState } from 'react';
import { Button, Icon } from '@/components';
import { go } from '@/nav';
import { refreshEngine } from '@/store/live';
import { setupSteps, type SetupStep } from '@/store/rules';
import { readKey, writeKey } from '@/store/storage';
import { useStore, useStoreShallow } from '@/store/store';

/** Per browser: '1' once the person dismissed the finished checklist. */
export const KEY_SETUP = 'das-setup-done';

/**
 * "Finish setup" on the Workspace, outside demo mode: the steps from an empty workspace to a site that is live, each
 * ticked from what the server reports (rules.ts setupSteps) and linking to the screen where it is done. While a step
 * is open the card stays; once every step is done it says so and can be dismissed, which this browser remembers.
 */
export function SetupChecklist() {
  const [live, sites, session, sample] = useStoreShallow(s => [s.live, s.sites, s.session, s.sample] as const);
  const setPop = useStore(s => s.setPop);
  const [dismissed, setDismissed] = useState(() => readKey(KEY_SETUP) === '1');
  if (sample || !session) return null;
  const steps = setupSteps({ live, sites, session });
  const done = steps.filter(x => x.done).length, all = done === steps.length;
  if (all && dismissed) return null;
  const open = (x: SetupStep) => {
    if (x.to === 'account') { setPop('menu'); return; }
    /* The engine step: ask the server again first, so signing in to OpenAI API ticks it without a reload. */
    if (x.id === 'engine' && session.role !== 'viewer') void refreshEngine();
    if (x.to) go(x.to);
  };
  const next = steps.find(x => !x.done);
  return (
    <section className="setup" id="setup" aria-labelledby="setupT">
      <div className="setup-head">
        <h2 id="setupT">{all ? 'Setup complete' : 'Finish setup'}</h2>
        <span className="note">{done} of {steps.length} done</span>
        {all ? <Button size="sm" variant="tonal" onClick={() => { writeKey(KEY_SETUP, '1'); setDismissed(true); }}>Dismiss</Button> : null}
      </div>
      <div className="setup-bar" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><i style={{ width: done / steps.length * 100 + '%' }} /></div>
      <ol className="setup-list">
        {steps.map(x => (
          <li key={x.id} data-step={x.id} data-done={x.done ? '1' : '0'}>
            <Icon name={x.done ? 'check_circle' : 'radio_button_unchecked'} fill={x.done} />
            <div>
              <b>{x.title}<span className="sr-only">{x.done ? ' (done)' : ' (to do)'}</span></b>
              {x.done ? null : <span className="sub2">{x.hint}</span>}
            </div>
            {!x.done && x.to ? <Button size="sm" variant={x === next ? 'tonal' : 'text'} onClick={() => open(x)}>{x.action}</Button> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

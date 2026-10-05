import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Select, Sheet, SheetActions } from '@/components';
import { sendRequest } from '@/store/live';
import { liveOn as liveOnOf, engineReady as runtimeReady, codexLocal, runtimeModel } from '@/store/rules';
import { go } from '@/nav';
import { kwRequestError } from '@/store/slices/research';
import { useStore } from '@/store/store';

const GOALS = ['Find a new topic cluster', 'Expand an existing cluster', 'Refresh search volumes'] as const;
/** Outside demo mode nothing measures search volume, so the goal that promises it is not offered. */
const goalsFor = (sample: boolean): readonly string[] => sample ? GOALS : GOALS.filter(g => g !== 'Refresh search volumes');

/**
 * The prototype's "kwreq" form. In live mode the request goes to the local server (sendRequest); otherwise it is queued
 * in the browser for the simulated Keyword agent (addKwRequest).
 */
export function KwRequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="sheetT">
      <KwRequestForm onClose={onClose} />
    </Sheet>
  );
}

function KwRequestForm({ onClose }: { onClose: () => void }) {
  const sites = useStore(s => s.sites);
  const siteFilter = useStore(s => s.siteFilter);
  const liveOn = useStore(liveOnOf);
  const addKwRequest = useStore(s => s.addKwRequest);
  const goals = goalsFor(useStore(s => s.sample));
  const [siteId, setSiteId] = useState(() => sites.find(x => x.id === siteFilter)?.id ?? sites[0]?.id ?? '');
  const [goal, setGoal] = useState<string>(GOALS[0]);
  const [topic, setTopic] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const sample = useStore(s => s.sample);
  const engineReady = useStore(runtimeReady);
  const local = useStore(codexLocal);
  const live = useStore(s => s.live);
  const writer = useStore(s => s.agents.find(a => a.id === 'kw'));
  const site = sites.find(x => x.id === siteId);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = { siteId, topic, goal };
    if (!liveOn) {
      const err = addKwRequest(input);
      if (err === null) onClose(); else setMsg(err);
      return;
    }
    const st = useStore.getState();
    if (!st.guard()) return;
    const err = kwRequestError(st, input);
    if (err) { setMsg(err); return; }
    setBusy(true);
    try {
      await sendRequest({ siteId, topic: topic.trim(), goal });
      onClose();
    } catch (x) {
      setBusy(false);
      setMsg(x instanceof Error ? x.message : String(x));
    }
  };

  return (
    <form onSubmit={submit}>
      <h2 id="sheetT">New research request</h2>
      <p>The Keyword agent researches this topic for one site, in that site's country and language.</p>
      {!sample && !engineReady ? <p className="err">{local ? 'Sign in to Codex on this computer before sending this request.' : 'Connect OpenAI before sending this request.'} <Button variant="text" onClick={() => { onClose(); go('workspace'); }}>Back to getting started</Button></p> : null}
      <Fields>
        <Field label="Site">
          <Select id="krSite" label="Site" value={siteId} onChange={setSiteId} options={sites.map(x => ({ value: x.id, label: `${x.domain} (${x.country})` }))} />
        </Field>
        <Field label="Goal">
          <Select id="krGoal" label="Goal" value={goal} onChange={setGoal} options={goals.map(g => ({ value: g, label: g }))} />
        </Field>
        <Field label="Topic or seed keywords" wide>
          <input type="text" id="krTopic" required maxLength={80} placeholder="cold brew coffee at home" value={topic} onChange={e => setTopic(e.target.value)} />
        </Field>
      </Fields>
      {!sample ? <p className="note">{site ? `${site.country} · ${site.lang}. ` : ''}Model: {runtimeModel({live}, writer?.model || 'not configured')}. This request uses {local ? 'your ChatGPT usage limits' : 'your OpenAI API balance'} and may take a few minutes. It returns keyword ideas; it does not write an article or publish anything.</p> : null}
      <p className="err" id="formMsg" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={busy || (!sample && !engineReady)}>{busy ? 'Sending…' : 'Send to Keyword agent'}</Button>
      </SheetActions>
    </form>
  );
}

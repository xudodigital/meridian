/* "Run workflow": starts "Weekly content" for a site now. Outside demo mode only; the server starts the run. */
import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Select, Sheet, SheetActions } from '@/components';
import { N_DEFAULT } from '@/store/liveWorkflows';
import { siteById } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { N_OPTIONS } from './ScheduleSheet';

export function RunSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="wfRunT">
      {open ? <RunForm onClose={onClose} /> : null}
    </Sheet>
  );
}

function RunForm({ onClose }: { onClose: () => void }) {
  const [sites, siteFilter, workflows] = useStoreShallow(s => [s.sites, s.siteFilter, s.live.workflows] as const);
  const runWorkflow = useStore(s => s.runWorkflow);
  const [site, setSite] = useState(siteById({ sites }, siteFilter)?.id ?? sites[0]?.id ?? '');
  const [n, setN] = useState(N_DEFAULT);
  const [topic, setTopic] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const at = siteById({ sites }, site);
  const taken = Object.values(workflows).some(r => r.status === 'running' && r.siteId === site);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await runWorkflow({ siteId: site, n, topic });
    setBusy(false);
    if (err) setMsg(err); else if (err === null) onClose();
  };
  return (
    <form onSubmit={e => { void submit(e); }}>
      <h2 id="wfRunT">Run Weekly content</h2>
      <p>Starts research and drafts now. Review articles before building, then approve deployment.</p>
      <Fields>
        <Field label="Site" wide>
          <Select id="wfRunSite" label="Site" value={site} onChange={v => { setSite(v); setMsg(''); }} options={sites.map(s => ({ value: s.id, label: `${s.domain} (${s.country})` }))} />
        </Field>
        <Field label="Articles">
          <Select id="wfRunN" label="Articles" value={String(n)} onChange={v => setN(Number(v))} options={N_OPTIONS} />
        </Field>
        <Field label="Research topic (optional)">
          <input id="wfRunTopic" type="text" maxLength={80} autoComplete="off" placeholder={at?.topic ? `The site's topic: ${at.topic}` : 'The site has no topic yet: enter one'} value={topic} onChange={e => setTopic(e.target.value)} />
        </Field>
      </Fields>
      <p className="note">{taken
        ? 'A workflow is already running for this site. Wait for it to finish, or cancel it.'
        : 'This is paid agent work: one research job and one job per article, within the site\'s daily budget.'}</p>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" icon="play_arrow" disabled={busy || taken || !site}>Start</Button>
      </SheetActions>
    </form>
  );
}

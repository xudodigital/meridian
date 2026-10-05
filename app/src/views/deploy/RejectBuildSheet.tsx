import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Sheet, SheetActions } from '@/components';
import { useStore } from '@/store/store';
import type { BuildWire } from '@/store/types';

/** "Reject" on a website build: asks why, because the reason is kept with the build for the next one. */
export function RejectBuildSheet({ build, onClose }: { build: BuildWire | null; onClose: () => void }) {
  return (
    <Sheet open={!!build} onClose={onClose} labelledBy="rbT">
      {build ? <RejectForm build={build} onClose={onClose} /> : null}
    </Sheet>
  );
}

function RejectForm({ build, onClose }: { build: BuildWire; onClose: () => void }) {
  const rejectBuild = useStore(s => s.rejectBuild);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await rejectBuild(build.id, note);
    setBusy(false);
    if (err) setMsg(err); else onClose();
  };
  return (
    <form onSubmit={e => { void submit(e); }}>
      <h2 id="rbT">Reject {build.domain} v{build.version}?</h2>
      <p>It will not go live. Say what is wrong, so the next build can fix it. The build stays listed and can still be downloaded.</p>
      <Fields>
        <Field label="Why it is rejected" wide>
          <textarea id="rbNote" rows={3} required placeholder="For example: the home page shows no photo, and the About page is missing." value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </Fields>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="danger" type="submit" disabled={busy}>Reject</Button>
      </SheetActions>
    </form>
  );
}

import { useState } from 'react';
import { Button, Field, Sheet } from '@/components';
import { useStore } from '@/store/store';
import { SheetForm } from './SheetForm';

/** Admin-only "Reset workspace", confirmed by typing RESET. Accounts, research, articles and the audit log are not deleted. */
export function ResetWorkspace() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="row"><Button variant="danger" icon="restart_alt" onClick={() => setOpen(true)}>Reset workspace</Button></div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Reset the workspace?"
        description="Sites, schedules, settings, your changes to agents and added skills go back to the defaults of a new workspace, for everyone. Accounts, research results, articles and the audit log are kept. This cannot be undone.">
        <ResetForm onClose={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

function ResetForm({ onClose }: { onClose: () => void }) {
  const resetWorkspace = useStore(s => s.resetWorkspace);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    if (typed !== 'RESET') { setMsg('Type RESET to confirm.'); return; }
    const err = await resetWorkspace(typed);
    if (err) setMsg(err); else onClose();
  };
  return (
    <SheetForm msg={msg} submitLabel="Reset workspace" onSubmit={() => void submit()} onCancel={onClose}>
      <Field label="Type RESET to confirm" wide><input type="text" id="rsConfirm" autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} /></Field>
    </SheetForm>
  );
}

import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Select, Sheet, SheetActions } from '@/components';
import { availModels, MODELS } from '@/store/rules';
import { useStore } from '@/store/store';

/** The Add agent form (the prototype's openForm('agent') and its submit). Models come from the connected providers. */
function AddAgentForm({ onDone }: { onDone: () => void }) {
  const ints = useStore(s => s.ints);
  const live = useStore(s => s.live);
  const addAgent = useStore(s => s.addAgent);
  const sample = useStore(s => s.sample);
  const avail = availModels({ ints, live });
  const models = avail.length ? avail : [...MODELS];
  const [name, setName] = useState('');
  const [model, setModel] = useState(models[0] ?? '');
  const [role, setRole] = useState('');
  const [msg, setMsg] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = addAgent({ name, role, model });
    if (r.ok) onDone(); else if (r.msg) setMsg(r.msg);
  };
  return (
    <form onSubmit={submit}>
      <h2 id="sheetT">Add an agent</h2>
      <p>{sample
        ? 'An agent is an AI model with its own role and skills. Attach skills afterwards in Models and skills.'
        : 'An agent is an AI model with its own role and skills. An agent you add is listed under Planned agents: Meridian has no job for it yet, so it does not run.'}</p>
      <Fields>
        <Field label="Name"><input type="text" id="agName" required maxLength={30} placeholder="Schema Markup" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Model"><Select id="agModel" label="Model" value={model} onChange={setModel} options={models.map(m => ({ value: m, label: m }))} /></Field>
        <Field label="Role" wide><input type="text" id="agRole" required maxLength={60} placeholder="Creates and validates schema" value={role} onChange={e => setRole(e.target.value)} /></Field>
      </Fields>
      <p className="err" id="formMsg" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onDone}>Cancel</Button>
        <Button variant="filled" type="submit">Add agent</Button>
      </SheetActions>
    </form>
  );
}

export function AddAgentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="sheetT">
      <AddAgentForm onDone={onClose} />
    </Sheet>
  );
}

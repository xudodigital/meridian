import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Sheet, SheetActions } from '@/components';
import { useStore } from '@/store/store';

/** "Change name" from the account menu: saved on the server, which records it for everything the person does from now on. */
export function ChangeNameSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Change your name" description="Shown in the account menu and recorded for everything you do from now on. Earlier entries keep the name they were made under.">
      <NameForm onClose={onClose} />
    </Sheet>
  );
}

function NameForm({ onClose }: { onClose: () => void }) {
  const current = useStore(s => s.session?.name ?? '');
  const changeName = useStore(s => s.changeName);
  const [name, setName] = useState(current);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const err = await changeName(name);
    setBusy(false);
    if (err) setMsg(err); else onClose();
  };
  return (
    <form onSubmit={submit}>
      <Fields><Field label="Your name" wide><input type="text" id="meName" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field></Fields>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={busy}>Save</Button>
      </SheetActions>
    </form>
  );
}

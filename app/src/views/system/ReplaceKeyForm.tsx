import { useState } from 'react';
import { Field, Sheet } from '@/components';
import { useStore } from '@/store/store';
import { SheetForm } from './SheetForm';

/** The prototype's openForm('keyrep', id) sheet (lines 1895-1896) with its submit handler (line 2172). */
export function ReplaceKeyForm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const name = useStore(s => s.ints.find(x => x.id === id)?.name);
  return (
    <Sheet open={name !== undefined} onClose={onClose} title={'Replace the ' + name + ' key'} description="The new key takes over at once. Agents keep running, and the old key stops being used.">
      {id ? <ReplaceFields id={id} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ReplaceFields({ id, onClose }: { id: string; onClose: () => void }) {
  const replaceKey = useStore(s => s.replaceKey);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const submit = () => { const err = replaceKey(id, key); if (err) setMsg(err); else onClose(); };
  return (
    <SheetForm msg={msg} submitLabel="Replace key" onSubmit={submit} onCancel={onClose}>
      <Field label="New API key" wide><input type="password" id="krKey" required minLength={8} autoComplete="off" placeholder="Paste the new key" value={key} onChange={e => setKey(e.target.value)} /></Field>
    </SheetForm>
  );
}

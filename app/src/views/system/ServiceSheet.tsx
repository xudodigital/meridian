import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Sheet, SheetActions } from '@/components';
import { refreshEngine } from '@/store/live';
import { useStore } from '@/store/store';
import type { IntegrationWire } from '@/store/types';

/**
 * Connect or change a service: the fields the server asks for (server/integrations.ts). Secret fields are never
 * filled in from the server; left empty when changing, they keep the stored value. Saving tests the service at once.
 */
export function ServiceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const w = useStore(s => id ? s.live.ints[id] : undefined);
  return (
    <Sheet open={!!w} onClose={onClose} title={w ? (w.connected && w.updatedAt ? 'Change ' + w.name : 'Connect ' + w.name) : ''} description={w?.help}>
      {w ? <ServiceForm key={w.id} w={w} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ServiceForm({ w, onClose }: { w: IntegrationWire; onClose: () => void }) {
  const saveService = useStore(s => s.saveService);
  const redirectUri = useStore(s => s.live.redirectUri);
  const snack = useStore(s => s.snack);
  const stored = !!w.updatedAt;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(w.fields.map(f => [f.k, f.secret ? '' : w.config[f.k] ?? ''])));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    /* Only what was typed is sent; an unchanged non-secret value is sent as it is, which the server accepts. */
    const err = await saveService(w.id, Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())));
    setBusy(false);
    if (err) { setMsg(err); return; }
    if (w.id === 'openai') {
      const saved = useStore.getState().live.ints.openai;
      if (saved?.status === 'bad') { setMsg(saved.msg || 'The API key was saved, but the connection failed. Check the key and try again.'); return; }
      setBusy(true);
      const engine = await refreshEngine();
      setBusy(false);
      if (engine?.mode !== 'codex-local' && engine?.mode !== 'openai-api') { setMsg(engine?.reason || 'The key was saved, but OpenAI is not ready yet. Check the connection and try again.'); return; }
    }
    onClose();
  };
  const copy = () => { navigator.clipboard.writeText(redirectUri).then(() => snack('Redirect URI copied'), () => undefined); };
  return (
    <form onSubmit={submit}>
      {w.id === 'openai' ? <p className="note">Create a key in your <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI API account</a> and paste it below. API usage is billed separately from ChatGPT. Saving tests the connection; it does not start an AI job.</p> : null}
      {w.id === 'google' ? (
        <div className="callout info" style={{ marginBottom: 12 }}>
          <span><b>Authorized redirect URI</b><br /><code>{redirectUri || 'http://localhost:4310/api/oauth/google/callback'}</code></span>
          <Button size="sm" variant="text" onClick={copy}>Copy</Button>
        </div>
      ) : null}
      <Fields>
        {w.fields.map(f => (
          <Field key={f.k} label={f.label} wide={f.k !== 'port'}>
            <input
              id={'svc-' + w.id + '-' + f.k}
              autoFocus={w.fields[0]?.k === f.k}
              type={f.secret ? 'password' : f.kind === 'number' ? 'text' : f.kind ?? 'text'}
              inputMode={f.kind === 'number' ? 'numeric' : undefined}
              autoComplete="off"
              placeholder={f.secret && stored ? 'Leave empty to keep the stored value' : f.placeholder ?? ''}
              required={!f.optional && !(f.secret && stored) && !w.worksWithout}
              value={values[f.k] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.k]: e.target.value }))}
            />
          </Field>
        ))}
      </Fields>
      {w.worksWithout ? <p className="note">{w.worksWithout}</p> : null}
      <p className="note">Saved encrypted on this computer's Meridian server. Only the last few characters are ever shown again.</p>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={busy}>{busy ? 'Saving and testing…' : 'Save and test'}</Button>
      </SheetActions>
    </form>
  );
}

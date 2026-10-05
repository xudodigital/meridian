import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field } from '@/components';
import { authApi } from '@/store/authApi';
import type { Me } from '@/store/types';
import { Qr } from './Qr';

/** "ABCD EFGH ..." so the setup key can be typed into an app by hand. */
export const groupKey = (k: string): string => k.replace(/(.{4})/g, '$1 ').trim();

/**
 * Setting up 2-step verification: the server makes a secret, shown as a QR code and as a setup key; a code from the
 * authenticator app confirms it; then the ten recovery codes are shown once. `onDone` gets the person as the server
 * now has them. Used in the account menu and on the screen that requires it after sign-in.
 */
export function TwoStepSetup({ onDone, onCancel, cancelLabel = 'Cancel' }: { onDone: (me: Me) => void; onCancel: () => void; cancelLabel?: string }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ me: Me; codes: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    authApi.twofaSetup().then(r => { if (live) setSetup(r); }, (e: unknown) => { if (live) setMsg(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) { setMsg('Enter the 6-digit code your authenticator app shows now.'); return; }
    setBusy(true); setMsg('');
    try { const r = await authApi.twofaEnable(code.replace(/\s/g, '')); setDone({ me: r.me, codes: r.recoveryCodes }); }
    catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const copy = () => {
    if (!done) return;
    try { void navigator.clipboard.writeText(done.codes.join('\n')).then(() => setCopied(true), () => setCopied(false)); } catch { setCopied(false); }
  };

  if (done) {
    return (
      <div className="twostep">
        <p><b>2-step verification is on.</b> Save these recovery codes now. Each one works once, in place of a code from your app, if you lose your phone. They are not shown again.</p>
        <ul className="recovery" aria-label="Recovery codes">{done.codes.map(c => <li key={c}><code>{c}</code></li>)}</ul>
        <div className="row">
          <Button variant="tonal" icon="content_copy" onClick={copy}>{copied ? 'Copied' : 'Copy codes'}</Button>
          <span className="grow" />
          <Button variant="filled" onClick={() => onDone(done.me)}>I saved them</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="twostep" onSubmit={verify}>
      <p>Scan the QR code with an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password), or type the setup key into it. Then enter the 6-digit code it shows.</p>
      {setup ? (
        <div className="qrbox">
          <Qr text={setup.uri} label="QR code for your authenticator app" />
          <div>
            <p className="note">Setup key</p>
            <p><code id="tsKey">{groupKey(setup.secret)}</code></p>
            <p className="note">Time-based, 6 digits, every 30 seconds.</p>
          </div>
        </div>
      ) : msg ? null : <p className="note">Preparing a setup key…</p>}
      <Field label="6-digit code from the app"><input type="text" id="tsCode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={e => setCode(e.target.value)} /></Field>
      <p className="err" hidden={!msg}>{msg}</p>
      <div className="row">
        <Button variant="text" onClick={onCancel}>{cancelLabel}</Button>
        <span className="grow" />
        <Button variant="filled" type="submit" disabled={!setup || busy}>Turn on</Button>
      </div>
    </form>
  );
}

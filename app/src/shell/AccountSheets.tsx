/* The account menu's sheets besides Change name: Change password and 2-step verification. Both talk to the server
   (authApi.ts); passwords are sent once and never kept in the page's state after the sheet closes. */
import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Sheet, SheetActions } from '@/components';
import { authApi } from '@/store/authApi';
import { passwordError } from '@/store/session';
import { useStore } from '@/store/store';
import { TwoStepSetup } from './TwoStepSetup';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);

export function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Change your password" description="Your other sessions are signed out when the password changes.">
      <PasswordForm onClose={onClose} />
    </Sheet>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const snack = useStore(s => s.snack);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!current) { setMsg('Enter your current password.'); return; }
    const err = passwordError(next, confirm);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    try {
      const r = await authApi.password(current, next, confirm);
      snack(r.endedSessions ? `Password changed. ${r.endedSessions} other session${r.endedSessions === 1 ? ' was' : 's were'} signed out.` : 'Password changed.', 'lock');
      onClose();
    } catch (x) { setMsg(message(x)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <Fields>
        <Field label="Current password" wide><input type="password" id="pwCurrent" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password (at least 12 characters)" wide><input type="password" id="pwNext" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" wide><input type="password" id="pwConfirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
      </Fields>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={busy}>Change password</Button>
      </SheetActions>
    </form>
  );
}

/** Turns 2-step verification on (QR code, code, recovery codes) or off (with the password). */
export function TwoStepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const on = useStore(s => !!s.session?.twofa);
  return (
    <Sheet open={open} onClose={onClose} title="2-step verification"
      description={on ? 'On. Signing in asks for a code from your authenticator app after the password.' : 'Signing in will also need a code from an authenticator app on your phone, after the password.'}>
      {on ? <TurnOff onClose={onClose} /> : <TwoStepOn onClose={onClose} />}
    </Sheet>
  );
}

function TwoStepOn({ onClose }: { onClose: () => void }) {
  const setMe = useStore(s => s.setMe);
  const snack = useStore(s => s.snack);
  return <TwoStepSetup onCancel={onClose} onDone={me => { setMe(me); snack('2-step verification is on.', 'verified_user'); onClose(); }} />;
}

function TurnOff({ onClose }: { onClose: () => void }) {
  const setMe = useStore(s => s.setMe);
  const snack = useStore(s => s.snack);
  const required = useStore(s => s.settings.twofa && !s.sample);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try { setMe(await authApi.twofaDisable(pass)); snack('2-step verification is off.', 'lock_open'); onClose(); }
    catch (x) { setMsg(message(x)); }
    finally { setBusy(false); }
  };
  if (required) {
    return (
      <>
        <p className="note">Settings require 2-step verification for everyone, so it stays on. If you lost your phone, use a recovery code to sign in, or ask an admin to reset it.</p>
        <SheetActions><Button variant="filled" onClick={onClose}>Close</Button></SheetActions>
      </>
    );
  }
  return (
    <form onSubmit={submit}>
      <Fields><Field label="Your password, to confirm" wide><input type="password" id="tsPass" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" /></Field></Fields>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="danger" type="submit" disabled={busy}>Turn off</Button>
      </SheetActions>
    </form>
  );
}

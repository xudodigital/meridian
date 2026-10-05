import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Icon } from '@/components';
import { authApi, type ResetInfo } from '@/store/authApi';
import { passwordError } from '@/store/session';
import { useStore } from '@/store/store';
import { LoginFrame } from './Login';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);
/** Shown on the sign-in screen after a reset. */
export const RESET_NOTE = 'Your password was changed and every session was signed out. Sign in with the new password.';

/**
 * /reset/<token>: the page a password reset link opens (from the email, or from an admin). The person chooses a new
 * password; the server then ends every session of theirs. They are not signed in here: they sign in with the new
 * password, and with their 2-step code when that is on. The token travels only in the link.
 */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [bad, setBad] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    authApi.resetLookup(token).then(i => { if (live) setInfo(i); }, (e: unknown) => { if (live) setBad(message(e)); });
    return () => { live = false; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = passwordError(pass, confirm);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    try {
      const r = await authApi.resetPassword(token, { password: pass, confirm });
      setPass(''); setConfirm('');
      /* The server ended this person's sessions, this browser's too: the page signs out with the reason (and the
         router then shows the sign-in screen). Someone else signed in on this browser stays signed in. */
      const s = useStore.getState();
      if (s.session && s.session.email === r.email) { s.signOut(RESET_NOTE, false); return; }
      if (!s.session) useStore.setState(d => { d.loginNote = RESET_NOTE; });
      setDone(true);
    }
    catch (x) { setMsg(message(x)); }
    finally { setBusy(false); }
  };

  if (bad) {
    return (
      <LoginFrame>
        <div className="lform">
          <h1>This link does not work</h1>
          <p className="note" id="lgNote">{bad}</p>
          <Button variant="filled" size="lg" id="lgBtn" onClick={onDone}>Go to sign in</Button>
        </div>
      </LoginFrame>
    );
  }
  if (done) {
    return (
      <LoginFrame>
        <div className="lform">
          <h1>Password changed</h1>
          <p className="lnote" id="lgNote" role="status"><Icon name="lock" /><span>Your new password is set, and every session of {info?.email} was signed out.</span></p>
          <p className="note">Sign in with the new password. If 2-step verification is on for your account, you still enter its code.</p>
          <Button variant="filled" size="lg" id="lgBtn" onClick={onDone}>{useStore.getState().session ? 'Back to Meridian' : 'Go to sign in'}</Button>
        </div>
      </LoginFrame>
    );
  }
  return (
    <LoginFrame>
      <form className="lform" onSubmit={submit}>
        <h1>Set a new password</h1>
        <p className="note" id="lgNote">
          {info ? <>Choose a new password for <b>{info.email}</b>. Every signed-in session of this account is signed out when you save it.</> : 'Checking the link…'}
        </p>
        <div className="lstep" hidden={!info}>
          {/* For password managers: the account this password belongs to. */}
          <input type="email" value={info?.email ?? ''} readOnly hidden autoComplete="username" />
          <Field label="New password (at least 12 characters)"><input type="password" id="rsPass" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><input type="password" id="rsConfirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <p className="err" id="lgMsg" hidden={!msg}>{msg}</p>
        <Button type="submit" variant="filled" size="lg" id="lgBtn" disabled={!info || busy}>Save new password</Button>
      </form>
    </LoginFrame>
  );
}

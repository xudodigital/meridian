import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field } from '@/components';
import { teamApi, type InviteInfo } from '@/store/authApi';
import { ROLE_LABEL } from '@/store/constants';
import { nameError, passwordError } from '@/store/session';
import { useStore } from '@/store/store';
import { LoginFrame } from './Login';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);

/**
 * /invite/<token>: the page an invitation link opens. The person sets their name and password, and is signed in.
 * The token travels only in the link; the server keeps its hash and accepts it once, within 7 days.
 */
export function InviteAccept({ token, onDone }: { token: string; onDone: () => void }) {
  const signIn = useStore(s => s.signIn);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [bad, setBad] = useState('');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    teamApi.lookup(token).then(i => { if (live) setInfo(i); }, (e: unknown) => { if (live) setBad(message(e)); });
    return () => { live = false; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = nameError(name) || passwordError(pass, confirm);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    try { const me = await teamApi.accept(token, { name, password: pass, confirm }); signIn(me); onDone(); }
    catch (x) { setMsg(message(x)); }
    finally { setBusy(false); }
  };

  if (bad) {
    return (
      <LoginFrame>
        <div className="lform">
          <h1>This invitation does not work</h1>
          <p className="note" id="lgNote">{bad}</p>
          <Button variant="filled" size="lg" onClick={onDone}>Go to sign in</Button>
        </div>
      </LoginFrame>
    );
  }
  return (
    <LoginFrame>
      <form className="lform" onSubmit={submit}>
        <h1>Join Meridian</h1>
        <p className="note" id="lgNote">
          {info ? <>You are invited as <b>{ROLE_LABEL[info.role]}</b>{info.domain ? <> for <b>{info.domain}</b></> : null} with <b>{info.email}</b>. Choose your name and a password to sign in.</> : 'Checking the invitation…'}
        </p>
        <div className="lstep" hidden={!info}>
          <Field label="Your name"><input type="text" id="ivName" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Password (at least 12 characters)"><input type="password" id="ivPass" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm password"><input type="password" id="ivConfirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <p className="err" id="lgMsg" hidden={!msg}>{msg}</p>
        <Button type="submit" variant="filled" size="lg" id="lgBtn" disabled={!info || busy}>Create account and sign in</Button>
      </form>
    </LoginFrame>
  );
}

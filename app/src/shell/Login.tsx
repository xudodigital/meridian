import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Icon } from '@/components';
import { bootAuth, checkResetByEmail, ENDED_NOTE, resetByEmailKnown } from '@/store/auth';
import { authApi } from '@/store/authApi';
import { emailError, nameError, passwordError } from '@/store/session';
import { useStore } from '@/store/store';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** The frame of every signed-out screen (the prototype's #login): the brand panel and the form sheet. */
export function LoginFrame({ children }: { children: ReactNode }) {
  useEffect(() => { document.title = 'Meridian'; }, []);
  return (
    <div className="login" id="login">
      <div className="lhero">
        <div className="lbrand"><span className="logo"><Icon name="hub" /></span>Meridian</div>
        <div className="ltext">
          <h2>Run every SEO agent from one control room.</h2>
          <ul>
            <li><Icon name="groups" />A live workspace for every agent</li>
            <li><Icon name="front_hand" />Human approval before anything publishes</li>
            <li><Icon name="language" />One profile per domain and country</li>
          </ul>
        </div>
      </div>
      <div className="lsheet">
        {children}
        <p className="lfoot">Accounts are kept by the Meridian server on this computer.</p>
      </div>
    </div>
  );
}

/**
 * What a signed-out person sees: while the server is asked, "Create the owner account" when no account exists yet
 * (first run), otherwise "Sign in"; or how to start the server when it does not answer.
 */
export function Login() {
  const auth = useStore(s => s.auth);
  return (
    <LoginFrame>
      {auth === 'setup' ? <OwnerForm /> : auth === 'signin' ? <SignInForm /> : auth === 'offline' ? <Offline /> : (
        <div className="lform"><h1>Meridian</h1><p className="note" id="lgNote">Connecting to the Meridian server…</p></div>
      )}
    </LoginFrame>
  );
}

function Offline() {
  return (
    <div className="lform">
      <h1>The server is not running</h1>
      <p className="note" id="lgNote">Meridian keeps accounts and the workspace on its server. Start it with <code>./start.sh</code> in the Meridian folder, then try again.</p>
      <Button variant="filled" size="lg" id="lgBtn" onClick={() => { useStore.setState(d => { d.auth = 'loading'; }); void bootAuth(); }}>Try again</Button>
    </div>
  );
}

/** First run: the owner account. The first account is an admin; everyone else joins through an invitation. */
function OwnerForm() {
  const signIn = useStore(s => s.signIn);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = nameError(name) || emailError(email) || passwordError(pass, confirm);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    try { signIn(await authApi.setup({ name, email: email.trim(), password: pass, confirm })); }
    catch (x) {
      setMsg(message(x));
      /* Someone created the owner meanwhile: switch to sign-in. */
      if (/already exists/.test(message(x))) useStore.setState(d => { d.auth = 'signin'; });
    } finally { setBusy(false); }
  };
  return (
    <form className="lform" onSubmit={submit}>
      <h1>Create the owner account</h1>
      <p className="note" id="lgNote">No account exists yet. This first account is the owner, with full access. Everyone else joins through an invitation link from Team and roles.</p>
      <div className="lstep">
        <Field label="Your name"><input type="text" id="lgNameIn" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
        <Field label="Work email"><input type="email" id="lgEmail" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Password (at least 12 characters)"><input type="password" id="lgPass" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" id="lgConfirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <p className="err" id="lgMsg" hidden={!msg}>{msg}</p>
      <Button type="submit" variant="filled" size="lg" id="lgBtn" disabled={busy}>Create account</Button>
    </form>
  );
}

/**
 * Why the person is on the sign-in screen again. A session the server ended (ENDED_NOTE) is explained: it is nearly
 * always the idle sign-out, and nothing was lost. Any other note (the demo's idle sign-out) is shown as it is.
 */
export const signedOutNote = (note: string): string => note === ENDED_NOTE
  ? 'You were signed out because your session ended, usually after a while without activity. Your work is saved. Sign in to continue.'
  : note;

/** Sign-in: email and password, then the 2-step code when the person has it on. */
function SignInForm() {
  const loginNote = useStore(s => s.loginNote);
  const signIn = useStore(s => s.signIn);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ticket) { setCode(''); codeRef.current?.focus(); } }, [ticket]);
  /* A link by email is offered only when the server can send one (Email (SMTP) is set up); otherwise an admin helps. */
  const [forgot, setForgot] = useState(false);
  const [byEmail, setByEmail] = useState(resetByEmailKnown);
  useEffect(() => { let live = true; void checkResetByEmail().then(on => { if (live) setByEmail(on); }); return () => { live = false; }; }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (ticket) {
        if (!code.trim()) { setMsg('Enter the 6-digit code from your authenticator app, or a recovery code.'); return; }
        signIn(await authApi.code(ticket, code.trim()));
        return;
      }
      if (!email.trim() || !pass) { setMsg('Enter your email and password.'); return; }
      const r = await authApi.signIn({ email: email.trim(), password: pass });
      if ('me' in r) signIn(r.me); else { setPass(''); setTicket(r.ticket); }
    } catch (x) {
      setMsg(message(x));
      if (ticket && /expired/.test(message(x))) setTicket(null);
    } finally { setBusy(false); }
  };

  if (forgot) return <ForgotForm email={email} onBack={() => setForgot(false)} />;
  return (
    <form className="lform" onSubmit={submit}>
      <h1>Sign in</h1>
      {loginNote ? <p className="lnote" id="lgNote" role="status"><Icon name="schedule" /><span>{signedOutNote(loginNote)}</span></p> : <p className="note" id="lgNote" hidden />}
      <div className="lstep" id="lgStep1" hidden={!!ticket}>
        <Field label="Work email"><input type="email" id="lgEmail" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password"><input type="password" id="lgPass" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" /></Field>
      </div>
      <div className="lstep" id="lgStep2" hidden={!ticket}>
        <Field label="6-digit verification code"><input ref={codeRef} type="text" id="lgCode" inputMode="numeric" autoComplete="one-time-code" maxLength={14} placeholder="123456" value={code} onChange={e => setCode(e.target.value)} /></Field>
        <p className="note">2-step verification is on for this account. Enter the code your authenticator app shows now, or one of your recovery codes.</p>
        <Button variant="text" onClick={() => { setMsg(''); setTicket(null); }}>Use a different account</Button>
      </div>
      <p className="err" id="lgMsg" hidden={!msg}>{msg}</p>
      <Button type="submit" variant="filled" size="lg" id="lgBtn" disabled={busy}>{ticket ? 'Verify and sign in' : 'Sign in'}</Button>
      {ticket ? null : byEmail
        ? <Button variant="text" id="lgForgot" onClick={() => { setMsg(''); setForgot(true); }}>Forgot your password?</Button>
        : <p className="note" id="lgForgotNote">Forgot your password? Ask an admin: they make a one-time reset link for you in Team and roles.</p>}
    </form>
  );
}

/**
 * "Forgot your password?": asks the server to email a one-time link. The server answers the same whether the email
 * has an account or not, and that answer is shown as it is, so this screen cannot be used to find out who has one.
 */
function ForgotForm({ email: typed, onBack }: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(typed);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = emailError(email);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    try { setSent((await authApi.resetRequest(email.trim())).message); }
    catch (x) { setMsg(message(x)); }
    finally { setBusy(false); }
  };
  if (sent) {
    return (
      <div className="lform">
        <h1>Check your email</h1>
        <p className="lnote" id="lgNote" role="status"><Icon name="mail" /><span>{sent}</span></p>
        <p className="note">The link works once. No email after a few minutes? Check the spelling and your spam folder, or ask an admin for a reset link.</p>
        <Button variant="filled" size="lg" id="lgBtn" onClick={onBack}>Back to sign in</Button>
      </div>
    );
  }
  return (
    <form className="lform" onSubmit={submit}>
      <h1>Forgot your password?</h1>
      <p className="note" id="lgNote">Enter the email you sign in with. Meridian emails you a link to set a new password. The link works once, for 30 minutes.</p>
      <div className="lstep">
        <Field label="Work email"><input type="email" id="lgEmail" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></Field>
      </div>
      <p className="err" id="lgMsg" hidden={!msg}>{msg}</p>
      <Button type="submit" variant="filled" size="lg" id="lgBtn" disabled={busy}>Email me a link</Button>
      <Button variant="text" id="lgBack" onClick={onBack}>Back to sign in</Button>
    </form>
  );
}

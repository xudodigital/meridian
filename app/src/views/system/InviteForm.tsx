import { useState } from 'react';
import { Button, Field, Select, Sheet, SheetActions } from '@/components';
import { useStore } from '@/store/store';
import type { UserRole } from '@/store/types';
import { SheetForm } from './SheetForm';

export const ROLES: readonly UserRole[] = ['Native reviewer', 'Editor', 'Viewer', 'Admin'];
export const isRole = (v: string): v is UserRole => (ROLES as readonly string[]).includes(v);

/**
 * The prototype's openForm('user') sheet (lines 1901-1902) with its submit handler (lines 2151-2154). Outside demo mode
 * the server makes a one-time link, which this sheet then shows with a Copy button for the admin to share.
 */
export function InviteForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sample = useStore(s => s.sample);
  return (
    <Sheet open={open} onClose={onClose} title="Invite a person"
      description={sample ? 'They get an email invitation. Native reviewers only see the review queue for the site you choose.' : 'Meridian makes a one-time link for this person. Native reviewers only see the review queue for the site you choose.'}>
      <InviteFields onClose={onClose} />
    </Sheet>
  );
}

function InviteFields({ onClose }: { onClose: () => void }) {
  const sites = useStore(s => s.sites);
  const inviteUser = useStore(s => s.inviteUser);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('Native reviewer');
  const [site, setSite] = useState('');
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const submit = async () => {
    const r = await inviteUser({ email, role, site: role === 'Native reviewer' ? site : '' });
    if (!r.ok) setMsg(r.msg); else if (r.link) setLink(r.link); else onClose();
  };
  if (link) return <InviteLink link={link} email={email.trim().toLowerCase()} onClose={onClose} />;
  return (
    <SheetForm msg={msg} submitLabel="Create invitation" onSubmit={() => void submit()} onCancel={onClose}>
      <Field label="Work email" wide><input type="text" id="usEmail" required placeholder="reviewer@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field label="Role"><Select id="usRole" label="Role" value={role} onChange={v => { if (isRole(v)) setRole(v); }} options={ROLES.map(r => ({ value: r, label: r }))} /></Field>
      <Field label="Site access"><Select id="usScope" label="Site access" value={site} onChange={setSite} options={[{ value: '', label: 'All sites' }, ...sites.map(x => ({ value: x.id, label: x.domain }))]} /></Field>
    </SheetForm>
  );
}

/** The link to share, once. */
function InviteLink({ link, email, onClose }: { link: string; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false)); } catch { setCopied(false); }
  };
  return (
    <>
      <p><b>Share this link yourself.</b> Copy it and give it to {email}, for example in a chat. It works once, expires in 7 days, and is shown only now.</p>
      <div className="invlink">
        <input type="text" id="usLink" readOnly value={link} aria-label="Invitation link" onFocus={e => e.currentTarget.select()} />
        <Button variant="tonal" icon="content_copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <SheetActions><Button variant="filled" onClick={onClose}>Done</Button></SheetActions>
    </>
  );
}

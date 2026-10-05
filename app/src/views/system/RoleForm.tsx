import { useState } from 'react';
import { Field, Select, Sheet } from '@/components';
import { useStore } from '@/store/store';
import type { User, UserRole } from '@/store/types';
import { ROLES, isRole } from './InviteForm';
import { SheetForm } from './SheetForm';

/** "Change role": the role and, for a native reviewer, their one site. Saved on the server. */
export function RoleForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  return (
    <Sheet open={!!user} onClose={onClose} title={user ? 'Change the role of ' + user.name : ''} description="The change applies at once, also in browsers where they are signed in now.">
      {user ? <RoleFields user={user} onClose={onClose} /> : null}
    </Sheet>
  );
}

function RoleFields({ user, onClose }: { user: User; onClose: () => void }) {
  const sites = useStore(s => s.sites);
  const updateUser = useStore(s => s.updateUser);
  const [role, setRole] = useState<UserRole>(user.role);
  const [site, setSite] = useState(user.site ?? '');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    const err = await updateUser(user.id, { role, site: role === 'Native reviewer' ? site : '' });
    if (err) setMsg(err); else if (err === null) onClose();
  };
  return (
    <SheetForm msg={msg} submitLabel="Save" onSubmit={() => void submit()} onCancel={onClose}>
      <Field label="Role"><Select id="rlRole" label="Role" value={role} onChange={v => { if (isRole(v)) setRole(v); }} options={ROLES.map(r => ({ value: r, label: r }))} /></Field>
      <Field label="Site access"><Select id="rlSite" label="Site access" value={site} onChange={setSite} options={[{ value: '', label: 'All sites' }, ...sites.map(x => ({ value: x.id, label: x.domain }))]} /></Field>
    </SheetForm>
  );
}

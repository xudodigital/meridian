import { useEffect, useState } from 'react';
import { Button, Card, Cards, Chip, Icon, Pill, Table } from '@/components';
import { teamApi, type ResetLink } from '@/store/authApi';
import { dayTime, siteById } from '@/store/rules';
import { useStore } from '@/store/store';
import type { User } from '@/store/types';
import { InviteForm } from './system/InviteForm';
import { ResetLinkSheet } from './system/ResetLinkSheet';
import { RoleForm } from './system/RoleForm';
import { TeamSessions } from './system/TeamSessions';

const ROLES: readonly (readonly [name: string, icon: string, text: string])[] = [
  ['Admin', 'shield_person', 'Everything: agents, sites, keys, budgets and people.'],
  ['Editor', 'edit_note', 'Runs workflows and approves content and deploys. No keys or billing.'],
  ['Native reviewer', 'translate', 'Reviews articles for one site in their own language. Sees nothing else.'],
  ['Viewer', 'visibility', 'Reads every screen. Cannot change anything.'],
];

/**
 * Team and roles: people and open invitations, the invite form, roles. Prototype: vTeam(), lines 1698-1703. Slice:
 * system. Outside demo mode the list is the server's: accounts and invitations, changed there by an admin, who can
 * also make a one-time password reset link for someone and see and end everyone's signed-in sessions.
 */
export function Team() {
  const users = useStore(s => s.users);
  const sites = useStore(s => s.sites);
  const session = useStore(s => s.session);
  const sample = useStore(s => s.sample);
  const loaded = useStore(s => s.teamLoaded);
  const guard = useStore(s => s.guard);
  const loadTeam = useStore(s => s.loadTeam);
  const openConfirm = useStore(s => s.openConfirm);
  const updateUser = useStore(s => s.updateUser);
  const resetTwofa = useStore(s => s.resetTwofa);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; email: string; link: ResetLink } | null>(null);
  useEffect(() => { void loadTeam(); }, [loadTeam]);
  /* The server makes the link and keeps only its hash: it is shown once, in the sheet. */
  const makeResetLink = async (u: User) => {
    if (!guard()) return;
    try { setResetLink({ name: u.name, email: u.email, link: await teamApi.resetLink(u.id) }); }
    catch (e) { useStore.getState().snack(e instanceof Error ? e.message : String(e), 'error'); }
  };

  /* In demo mode the sample's first person stands for the one signed in. */
  const self = (u: User) => sample ? u.id === 'u1' : !u.invite && u.id === session?.id;
  const scope = (u: User) => u.site ? siteById({ sites }, u.site)?.domain ?? 'Removed site' : u.scope;
  const status = (u: User) => u.st === 'Invited' && u.expires
    ? <><Pill kind="warn">Invited</Pill> <span className="note">until {dayTime(u.expires)}</span></>
    : <><Pill kind={u.st === 'Active' ? 'ok' : u.st === 'Disabled' ? 'mut' : 'warn'}>{u.st}</Pill>{u.twofa ? <> <Pill kind="info">2-step on</Pill></> : null}</>;
  const actions = (u: User) => {
    if (self(u)) return null;
    if (sample) return <Button size="sm" variant="danger" onClick={() => openConfirm(`user:${u.id}`)}>Remove</Button>;
    if (u.invite) return <Button size="sm" variant="danger" onClick={() => openConfirm(`inv:${u.id}`)}>Revoke</Button>;
    const disabled = u.st === 'Disabled';
    return (
      <div className="row" style={{ gap: 4 }}>
        <Button size="sm" variant="text" onClick={() => { if (guard()) setEditing(u); }}>Change role</Button>
        <Button size="sm" variant="text" onClick={() => void updateUser(u.id, { disabled: !disabled }).then(err => { if (err) useStore.getState().snack(err, 'error'); })}>{disabled ? 'Enable' : 'Disable'}</Button>
        {disabled ? null : <Button size="sm" variant="text" onClick={() => void makeResetLink(u)}>Reset password</Button>}
        {u.twofa ? <Button size="sm" variant="text" onClick={() => void resetTwofa(u.id)}>Reset 2-step</Button> : null}
        <Button size="sm" variant="danger" onClick={() => openConfirm(`user:${u.id}`)}>Remove</Button>
      </div>
    );
  };

  return (
    <>
      <div className="sh">
        <p className="lede">Manage access and roles. Reviewers see only their own site.</p>
        <span className="grow" />
        <Button variant="filled" icon="person_add" onClick={() => { if (guard()) setInviting(true); }}>Invite person</Button>
      </div>
      <section>
        <h2>People</h2>
        <Table
          cols={['Name', 'Email', 'Role', 'Site access', 'Status', 'Actions']}
          rowKey={(_, i) => (users[i].invite ? 'i' : 'u') + users[i].id}
          loading={!sample && !loaded}
          empty={sample ? undefined : 'No people to show.'}
          rows={users.map(u => [
            self(u) ? <><b>{session?.name ?? u.name}</b> <Pill kind="info">You</Pill></> : <b>{u.name}</b>,
            <Chip>{u.email}</Chip>,
            u.role,
            scope(u),
            status(u),
            actions(u),
          ])}
        />
        {sample ? null : <p className="note">Invitation links expire in 7 days. At least one admin must remain.</p>}
      </section>
      {!sample && session?.role === 'admin' ? <TeamSessions users={users} /> : null}
      <section>
        <h2>Roles</h2>
        <Cards>
          {ROLES.map(([name, icon, text], i) => (
            <Card key={name}>
              <header>
                <span className={'ava s2 c' + (i % 4 + 1)} aria-hidden="true"><Icon name={icon} /></span>
                <div className="who"><h3>{name}</h3><p>{text}</p></div>
              </header>
            </Card>
          ))}
        </Cards>
      </section>
      <InviteForm open={inviting} onClose={() => setInviting(false)} />
      <RoleForm user={editing} onClose={() => setEditing(null)} />
      <ResetLinkSheet made={resetLink} onClose={() => setResetLink(null)} />
    </>
  );
}

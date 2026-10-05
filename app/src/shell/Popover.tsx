import { useState } from 'react';
import { Button, Dialog, Empty, Icon, IconButton, Pill } from '@/components';
import { go } from '@/nav';
import { ROLE_LABEL } from '@/store/constants';
import { ago, canSee, initials } from '@/store/rules';
import { isDark, useStore } from '@/store/store';
import { ChangePasswordSheet, TwoStepSheet } from './AccountSheets';
import { ChangeNameSheet } from './ChangeNameSheet';

type AccountSheet = 'name' | 'password' | 'twostep';

function Notifications() {
  const session = useStore(s => s.session);
  const notifs = useStore(s => s.notifs);
  const markAll = useStore(s => s.markNotificationsRead);
  const openNotification = useStore(s => s.openNotification);
  const setPop = useStore(s => s.setPop);
  const list = notifs.filter(n => canSee(session, n.view));
  return (
    <>
      <div className="ph">
        <h2>Notifications</h2>
        <Button size="sm" variant="text" onClick={markAll}>Mark all read</Button>
        <IconButton icon="close" label="Close" onClick={() => setPop(null)} />
      </div>
      <div className="nlist">
        {list.length ? list.map(n => (
          <button type="button" key={n.id} className={'nt' + (n.read ? ' read' : '')} onClick={() => { const v = openNotification(n.id); if (v) go(v); }}>
            <span className={'ni ' + n.k}><Icon name={n.icon} /></span>
            <span><b>{n.title}</b><span className="b">{n.body}</span><time>{ago(n.t)}</time></span>
            <i className="dot" />
          </button>
        )) : <Empty>You are all caught up.</Empty>}
      </div>
    </>
  );
}

function AccountMenu({ onOpen }: { onOpen: (sheet: AccountSheet) => void }) {
  const session = useStore(s => s.session);
  const site = useStore(s => s.sites.find(x => x.id === s.session?.site)?.domain);
  const theme = useStore(s => s.theme);
  const toggleTheme = useStore(s => s.toggleTheme);
  const signOut = useStore(s => s.signOut);
  if (!session) return null;
  const dark = isDark(theme);
  return (
    <>
      <div className="acct">
        <span className="me" aria-hidden="true">{initials(session.name)}</span>
        <div className="who"><h3>{session.name}</h3><p>{session.email}</p>{session.role === 'reviewer' && site ? <p className="note">Reviews {site}</p> : null}</div>
        <Pill kind="info">{ROLE_LABEL[session.role]}</Pill>
      </div>
      <div className="nlist">
        {session.role === 'admin' ? (
          <>
            <button type="button" className="nt" onClick={() => go('team')}><span className="ni info"><Icon name="group" /></span><span><b>Team and roles</b><span className="b">Invite people and set what they can do</span></span></button>
            <button type="button" className="nt" onClick={() => go('settings')}><span className="ni info"><Icon name="settings" /></span><span><b>Settings</b><span className="b">Budgets, limits and approval rules</span></span></button>
          </>
        ) : null}
        <button type="button" className="nt" onClick={() => onOpen('name')}><span className="ni info"><Icon name="badge" /></span><span><b>Change name</b><span className="b">The name recorded for what you do</span></span></button>
        <button type="button" className="nt" onClick={() => onOpen('password')}><span className="ni info"><Icon name="password" /></span><span><b>Change password</b><span className="b">Your current password, then a new one</span></span></button>
        <button type="button" className="nt" onClick={() => onOpen('twostep')}><span className={'ni ' + (session.twofa ? 'ok' : 'warn')}><Icon name="verified_user" /></span><span><b>2-step verification</b><span className="b">{session.twofa ? 'On: a code from your phone at sign-in' : 'Off: set it up with an authenticator app'}</span></span></button>
        <button type="button" className="nt" onClick={toggleTheme}><span className="ni info"><Icon name={dark ? 'light_mode' : 'dark_mode'} /></span><span><b>Switch to {dark ? 'light' : 'dark'} theme</b><span className="b">Change how the dashboard looks</span></span></button>
        <button type="button" className="nt" onClick={() => signOut()}><span className="ni bad"><Icon name="logout" /></span><span><b>Sign out</b><span className="b">You will need to sign in again</span></span></button>
      </div>
    </>
  );
}

/** The prototype's #pop: one popover panel under the top bar, showing notifications or the account menu. */
export function Popover() {
  const pop = useStore(s => s.pop);
  const setPop = useStore(s => s.setPop);
  const [sheet, setSheet] = useState<AccountSheet | null>(null);
  const close = () => setSheet(null);
  return (
    <>
      <Dialog id="pop" open={pop !== null} onClose={() => setPop(null)} backdropClose label={pop === 'menu' ? 'Account' : 'Notifications'}>
        {pop === 'notif' ? <Notifications /> : pop === 'menu' ? <AccountMenu onOpen={x => { setPop(null); setSheet(x); }} /> : null}
      </Dialog>
      <ChangeNameSheet open={sheet === 'name'} onClose={close} />
      <ChangePasswordSheet open={sheet === 'password'} onClose={close} />
      <TwoStepSheet open={sheet === 'twostep'} onClose={close} />
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Button, Pill, Table } from '@/components';
import { teamApi, type TeamSession } from '@/store/authApi';
import { stamp } from '@/store/rules';
import { useStore } from '@/store/store';
import type { User } from '@/store/types';

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);
const plural = (n: number): string => `${n} session${n === 1 ? '' : 's'}`;

/**
 * Team and roles > Signed-in sessions (admins, outside demo mode): every browser that is signed in, whose it is, the
 * device and when it was last used, with "Sign out" per session and "Sign out everywhere" per person. The list is
 * the server's (GET /api/sessions); it is loaded when the screen opens, when the team changes and after each action.
 */
export function TeamSessions({ users }: { users: readonly User[] }) {
  const me = useStore(s => s.session?.id);
  const guard = useStore(s => s.guard);
  const snack = useStore(s => s.snack);
  const [sessions, setSessions] = useState<TeamSession[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSessions(await teamApi.sessions()); setError(''); }
    catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { void load(); }, [load, users]);

  const run = async (what: () => Promise<string>) => {
    if (!guard() || busy) return;
    setBusy(true);
    try { snack(await what(), 'logout'); }
    catch (e) { snack(message(e), 'error'); }
    finally { setBusy(false); void load(); }
  };
  const people = users.filter(u => !u.invite);
  const nameOf = (id: string): string => people.find(u => u.id === id)?.name ?? 'Someone';
  const signOut = (x: TeamSession) => run(async () => { await teamApi.endSession(x.id); return `Signed out ${nameOf(x.userId)} on ${x.device}`; });
  const everywhere = (userId: string) => run(async () => {
    const r = await teamApi.signOutEverywhere(userId);
    if (userId === me) return r.ended ? `Signed out your ${r.ended === 1 ? 'other session' : r.ended + ' other sessions'}` : 'You are not signed in anywhere else';
    return r.ended ? `Signed out ${nameOf(userId)} everywhere (${plural(r.ended)})` : `${nameOf(userId)} was not signed in anywhere`;
  });

  /* People in the order of the table above, each with their sessions, most recently used first. */
  const list = sessions ?? [];
  const order = [...people.map(u => u.id), ...list.map(x => x.userId)].filter((id, i, all) => all.indexOf(id) === i);
  const grouped = order.flatMap(id => list.filter(x => x.userId === id).map((x, i, mine) => ({ x, first: i === 0, mine })));
  const rows = grouped.map(({ x, first, mine }) => {
    const self = x.userId === me, others = mine.filter(m => !m.current).length;
    return [
      first ? <b>{nameOf(x.userId)}</b> : <span className="sr-only">{nameOf(x.userId)}</span>,
      <>{x.device}{x.current ? <> <Pill kind="ok">This browser</Pill></> : null}</>,
      stamp(x.lastSeen),
      <div className="row" style={{ gap: 4 }}>
        {x.current ? null : <Button size="sm" variant="text" disabled={busy} onClick={() => void signOut(x)}>Sign out</Button>}
        {first && (self ? others > 0 : mine.length > 1) ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void everywhere(x.userId)}>{self ? 'Sign out my other sessions' : 'Sign out everywhere'}</Button> : null}
      </div>,
    ];
  });

  return (
    <section id="teamSessions">
      <div className="sh">
        <h2>Signed-in sessions</h2>
        <Button variant="text" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      {error && !sessions
        ? <p className="note" role="alert">The sessions could not be loaded: {error}</p>
        : <Table cols={['Person', 'Device', 'Last active', 'Actions']} num={[2]} loading={sessions === null} rowKey={(_, i) => grouped[i]!.x.id} rows={rows} empty="Nobody is signed in." />}
      <p className="note">End browser sessions here. To replace a lost or shared password, use Reset password.</p>
    </section>
  );
}

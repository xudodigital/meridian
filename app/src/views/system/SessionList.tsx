import { useEffect, useState } from 'react';
import { Button, Pill, Table } from '@/components';
import { ago } from '@/store/rules';
import { useStore } from '@/store/store';

/**
 * The signed-in person's own sessions: device (from the browser's user agent), when it was last active, "This browser",
 * and Sign out for each, plus "Sign out other sessions". Outside demo mode the list comes from the server.
 */
export function SessionList() {
  const sessions = useStore(s => s.sessions);
  const sample = useStore(s => s.sample);
  const loadSessions = useStore(s => s.loadSessions);
  const endSession = useStore(s => s.endSession);
  const endOtherSessions = useStore(s => s.endOtherSessions);
  /* Skeleton rows until the server answered; if it could not, the table says so instead of loading forever. */
  const [asked, setAsked] = useState(false);
  useEffect(() => { let on = true; void loadSessions().finally(() => { if (on) setAsked(true); }); return () => { on = false; }; }, [loadSessions]);
  const others = sessions.some(x => !x.cur);
  return (
    <>
      <Table
        cols={['Device', 'Last active', 'Actions']}
        rowKey={(_, i) => sessions[i].id}
        loading={!sample && !asked}
        empty="Your sessions could not be loaded. Reload the page to try again."
        rows={sessions.map(x => [
          <b>{x.dev}</b>,
          x.cur ? 'Now' : x.last ? ago(x.last) + ' · ' + x.where : x.where,
          x.cur ? <Pill kind="ok">{sample ? 'This device' : 'This browser'}</Pill> : <Button size="sm" variant="danger" onClick={() => endSession(x.id)}>Sign out</Button>,
        ])}
      />
      {others ? <div className="row"><Button variant="tonal" icon="logout" onClick={() => void endOtherSessions()}>Sign out other sessions</Button></div> : null}
    </>
  );
}

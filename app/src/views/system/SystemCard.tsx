import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Callout, Info, Icon, Pill, SwitchRow } from '@/components';
import { dayTime } from '@/store/rules';
import { ApiError } from '@/store/serverApi';
import { useStore } from '@/store/store';
import { backupHref, systemApi, type BackupWire, type QueueWire, type SystemHealth } from '@/store/systemApi';
import './system-card.css';

/** 1536 -> "1.5 kB", 3_600_000 -> "3.6 MB". Decimal units, as Finder shows them. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = n, u = 0;
  /* 999.5 and up rounds to 1000 of a unit: that is 1 of the next. */
  while (v >= 999.5 && u < units.length - 1) { v /= 1000; u++; }
  return (u === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')) + ' ' + units[u];
}

/** 42 -> "Just started", 11_520 -> "3 h 12 min", 190_000 -> "2 d 4 h". */
export function fmtUptime(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  if (m < 1) return 'Just started';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

const JOB: Record<string, string> = {
  'seo-task': 'Running an SEO task', request: 'Researching keywords', article: 'Writing an article', photos: 'Finding photos', build: 'Building a website', deploy: 'Deploying a website',
};
const hour = (h: number) => String(h).padStart(2, '0') + ':00';
const LOW_DISK = 2e9;

/** What the queue is doing, in two short lines. */
function queueText(q: QueueWire | null): { now: string; sub: string } {
  if (!q) return { now: 'Not reported', sub: 'This server does not report its queue.' };
  const waiting = q.total ?? Object.values(q.queued ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const wait = waiting ? `${waiting} waiting` : 'Nothing waiting';
  if (!q.running) return { now: waiting ? 'Starting the next job' : 'Idle', sub: wait };
  const min = Math.floor(q.running.ageMs / 60_000);
  return { now: JOB[q.running.kind] ?? 'Running a job', sub: `${min < 1 ? 'Just started' : `Running for ${fmtUptime(min * 60)}`} · ${wait}` };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="sys-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function Facts({ h }: { h: SystemHealth }) {
  const q = queueText(h.queue);
  const ready = h.engine.ready === true;
  const low = !!h.disk && h.disk.freeBytes < LOW_DISK;
  return (
    <dl className="sys-facts">
      <Fact label="Version"><b>{h.version}</b><small>Node {h.node.replace(/^v/, '')}</small></Fact>
      <Fact label="Running for"><b>{fmtUptime(h.uptimeSec)}</b><small>Since {dayTime(h.startedAt)}</small></Fact>
      <Fact label="Engine">
        {ready ? <Pill kind="ok">Ready</Pill> : <Pill kind="bad">Not available</Pill>}
        <small>{ready ? h.engine.mode === 'codex-local' ? 'Codex local · ChatGPT usage limits' : 'OpenAI Responses API' : h.engine.reason || 'OpenAI is not connected.'}</small>
      </Fact>
      <Fact label="Job queue"><b>{q.now}</b><small>{q.sub}</small></Fact>
      <Fact label="Database">
        {h.db.ok ? <b>{fmtBytes(h.db.bytes + h.db.walBytes)}</b> : <Pill kind="bad">Not responding</Pill>}
        <small>{h.db.ok ? 'Working' : 'Restart Meridian. If this stays, restore a backup.'}</small>
      </Fact>
      <Fact label="Free disk space">
        {h.disk ? <b>{fmtBytes(h.disk.freeBytes)}</b> : <b>Unknown</b>}
        {low ? <Pill kind="warn">Running low</Pill> : <small>{h.disk ? `of ${fmtBytes(h.disk.totalBytes)}` : 'Could not be measured.'}</small>}
      </Fact>
    </dl>
  );
}

function Backups({ h, list, listFailed }: { h: SystemHealth; list: BackupWire[] | null; listFailed: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const last = list?.[0] ?? h.backups.last;
  const backUp = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await systemApi.backup();
      setMsg({ bad: false, text: `Backup made: ${r.backup.name} (${fmtBytes(r.backup.bytes)}).` });
      qc.setQueryData(['system', 'backups'], r.backups);
      void qc.invalidateQueries({ queryKey: ['system', 'health'] });
    } catch (e) {
      setMsg({ bad: true, text: e instanceof ApiError ? e.message : 'The backup could not be made.' });
    } finally { setBusy(false); }
  };
  const k = h.backups;
  const autoEnabled = k.autoEnabled !== false;
  const setAuto = async (enabled: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const r = await systemApi.setAutoBackup(enabled);
      qc.setQueryData<SystemHealth>(['system', 'health'], old => old ? { ...old, backups: { ...old.backups, autoEnabled: r.autoEnabled } } : old);
      setMsg({ bad: false, text: r.autoEnabled ? 'Automatic nightly backups enabled.' : 'Automatic nightly backups disabled.' });
    } catch (e) {
      setMsg({ bad: true, text: e instanceof ApiError ? e.message : 'The backup setting could not be saved.' });
    } finally { setBusy(false); }
  };
  return (
    <div className="sys-backup">
      <div className="sys-backup-head">
        <div className="sys-backup-title">
          <b>Backups</b>
          <span>{last ? `Last backup ${dayTime(last.at)} · ${fmtBytes(last.bytes)}` : 'No backup yet'}</span>
        </div>
        <Button variant="tonal" icon="backup" disabled={busy} onClick={() => void backUp()}>{busy ? 'Backing up…' : 'Back up now'}</Button>
      </div>
      <SwitchRow id="auto-backup" checked={autoEnabled} disabled={busy} onChange={v => void setAuto(v)}>Automatic nightly backup</SwitchRow>
      {msg ? <p className={msg.bad ? 'sys-msg bad' : 'sys-msg'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p> : null}
      {listFailed ? <p className="sys-none">The list of backups could not be loaded.</p>
        : list === null ? <p className="sys-none">Loading backups…</p>
        : list.length === 0 ? <p className="sys-none">{autoEnabled ? `No backups yet. One is made every night at ${hour(k.nightlyHour)} while Meridian is running, or make one now.` : 'No backups stored. Automatic backups are off. You can make a manual backup when needed.'}</p>
        : (
          <ul className="sys-list" aria-label="Backups">
            {list.map(b => (
              <li key={b.name}>
                <span className="nw">{dayTime(b.at)}</span>
                <span className="sys-size">{fmtBytes(b.bytes)}</span>
                {backupHref(b.name) ? <a className="btn text sm" href={backupHref(b.name)} download={b.name} aria-label={`Download the backup of ${dayTime(b.at)}`}><Icon name="download" />Download</a> : <span />}
              </li>
            ))}
          </ul>
        )}
      <Info label="Backup details"><p className="note">
        A backup holds the database, the encryption key, photos and built websites, so it includes password hashes and stored API keys. Keep downloaded copies somewhere only you can reach.
        {autoEnabled ? ` Made every night at ${hour(k.nightlyHour)} while Meridian is running;` : ' Automatic backups are off;'} one a day is kept for {k.keepDaily} days, then one a week for {k.keepWeekly} weeks. To restore one, stop Meridian and run ./backup.sh restore.
      </p></Info>
    </div>
  );
}

/**
 * Settings > System, for admins outside demo mode: what the server is (version, uptime), whether its parts work
 * (engine, queue, database, disk), and backups: make one now, see the ones kept, download one.
 */
export function SystemCard() {
  const sid = useStore(s => s.session?.id ?? null);
  const health = useQuery({ queryKey: ['system', 'health'], queryFn: systemApi.health, enabled: !!sid, refetchInterval: 30_000 });
  const backups = useQuery({ queryKey: ['system', 'backups'], queryFn: systemApi.backups, enabled: !!sid });
  const h = health.data;
  const maint = h?.schedulers.maintenance;
  const s = h?.folders;
  return (
    <section className="sys" aria-labelledby="sys-h">
      <h2 id="sys-h">System</h2>
      {h ? (
        <>
          {health.isError ? <Callout icon="sync_problem" warn>These details may be out of date: the server did not answer the last check.</Callout> : null}
          <Facts h={h} />
          {s ? <p className="note sys-storage">Storage used: photos {fmtBytes(s.media)} · websites {fmtBytes(s.sites)} · backups {fmtBytes(s.backups)} · logs {fmtBytes(s.logs)} · job folders {fmtBytes(s.workspaces)}</p> : null}
          {maint && maint.errors.length ? <Callout icon="build" warn>The nightly maintenance of {dayTime(maint.at)} did not finish every step: {maint.errors.join(' ')}</Callout> : null}
          <Backups h={h} list={backups.data ?? null} listFailed={backups.isError} />
        </>
      ) : health.isError ? (
        <>
          <Callout icon="error">System details could not be loaded{health.error instanceof ApiError && health.error.status ? `: ${health.error.message}` : '. The Meridian server did not answer.'}</Callout>
          <div className="row"><Button icon="refresh" onClick={() => void health.refetch()}>Try again</Button></div>
        </>
      ) : <p className="sys-none" role="status">Loading system details…</p>}
    </section>
  );
}

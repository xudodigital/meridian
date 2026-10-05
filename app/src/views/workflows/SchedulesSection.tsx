/* The schedules on the Workflows tab outside demo mode: each "Weekly content" schedule with its next run on the site's
   own clock (the server works that out), an on/off switch, Run now, Edit and Remove. The access check of live sites is
   a fixed job of the server, so it is a read-only row here, not a schedule that could be edited. */
import { useState, type ReactNode } from 'react';
import { Button, Dialog, Empty, IconButton, Pill, SheetActions, SiteChip, Switch, Table } from '@/components';
import { cadenceText, realSchedule, zoneName, zoneTime } from '@/store/liveWorkflows';
import { inSite, siteById } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Schedule, ScheduleDueWire } from '@/store/types';
import { mayWrite, useOneAtATime } from '../deploy/parts';
import { ScheduleSheet } from './ScheduleSheet';
import './workflows.css';

const COLS = ['Workflow', 'Site', 'Runs', 'Next run', 'On', 'Actions'];

const articles = (n: number): string => `${n} article${n === 1 ? '' : 's'}`;

function NextRun({ c, due }: { c: Schedule; due: ScheduleDueWire | undefined }) {
  const note = due?.note ? <span className="wf-sched-note">{due.note}</span> : null;
  if (!realSchedule(c)) return <span className="note">Never: it has no site or time. Edit it to set them.</span>;
  if (!c.on) return <span className="wf-next">Paused{note}</span>;
  if (!due) return <span className="note">Saving…</span>;
  if (due.nextDue === null) return <span className="wf-next">—{note}</span>;
  return <span className="wf-next">{zoneTime(due.nextDue, due.zone)}<span className="wf-sched-note">{zoneName(due.zone)}</span>{note}</span>;
}

function Actions({ c, taken, onEdit, onRemove }: { c: Schedule; taken: boolean; onEdit: () => void; onRemove: () => void }) {
  const runSchedule = useStore(s => s.runSchedule);
  const [busy, once] = useOneAtATime();
  const name = `the ${c.wf} schedule`;
  return (
    <span className="wf-acts">
      {realSchedule(c) ? <Button size="sm" variant="text" disabled={busy || taken} title={taken ? 'A workflow is already running for this site' : undefined} aria-label={`Run ${name} now`} onClick={() => { void once(() => runSchedule(c.id)); }}>Run now</Button> : null}
      <IconButton icon="edit" label={`Edit ${name}`} title="Edit" onClick={onEdit} />
      <IconButton icon="delete" label={`Remove ${name}`} title="Remove" onClick={onRemove} />
    </span>
  );
}

export function SchedulesSection() {
  const [schedules, sites, siteFilter, due, workflows] = useStoreShallow(s => [s.schedules, s.sites, s.siteFilter, s.live.schedDue, s.live.workflows] as const);
  const write = useStore(mayWrite);
  const setOn = useStore(s => s.setScheduleOn);
  const removeSchedule = useStore(s => s.removeSchedule);
  const [edit, setEdit] = useState<Schedule | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const list = schedules.filter(c => !c.site || inSite({ siteFilter }, c.site));
  const running = new Set(Object.values(workflows).filter(r => r.status === 'running').map(r => r.siteId));
  const rows: ReactNode[][] = list.map(c => [
    <b>{c.wf}</b>,
    c.site ? <SiteChip id={c.site} /> : <span className="note">No site</span>,
    realSchedule(c) ? <span className="wf-next">{cadenceText(c)}<span className="wf-sched-note">{articles(c.n ?? 2)} per run{c.topic ? ` · topic: ${c.topic}` : ''}</span></span> : <span className="note">Not set</span>,
    <NextRun c={c} due={due[c.id]} />,
    write ? <Switch id={'sch-' + c.id} checked={c.on} label={`Run the ${c.wf} schedule` + (siteById({ sites }, c.site) ? ' of ' + siteById({ sites }, c.site)?.domain : '')} onChange={v => setOn(c.id, v)} /> : <Pill kind={c.on ? 'ok' : 'mut'}>{c.on ? 'On' : 'Paused'}</Pill>,
    write ? <Actions c={c} taken={!!c.site && running.has(c.site)} onEdit={() => setEdit(c)} onRemove={() => setRemoving(c)} /> : null,
  ]);
  /* Not a schedule: the server checks every live site again 6 hours after its last check (server/probe.ts). */
  rows.push([
    <b>Domain access check</b>,
    <span className="note">Every live site</span>,
    'Every 6 hours for live sites',
    <span className="note">6 hours after each site's last check</span>,
    <Pill kind="ok">Always on</Pill>,
    <span className="note">Built in</span>,
  ]);
  return (
    <>
      <Table cols={COLS} rows={rows} rowKey={(_, i) => list[i]?.id ?? 'access'} />
      {list.length ? null : (
        <Empty icon="event_repeat" title="No schedules yet">
          {sites.length ? 'Add one and Weekly content starts by itself for that site, at the time you choose on the site\'s own clock.' : 'Add a site first. A schedule belongs to one site.'}
        </Empty>
      )}
      <ScheduleSheet edit={edit} onClose={() => setEdit(null)} />
      <Dialog open={!!removing} onClose={() => setRemoving(null)} className="wf-ask" labelledBy="wfRmT">
        <h2 id="wfRmT">Remove this schedule?</h2>
        <p>{removing?.wf} will no longer start by itself{siteById({ sites }, removing?.site ?? null) ? ' for ' + siteById({ sites }, removing?.site ?? null)?.domain : ''}. A workflow that is running now is not affected.</p>
        <SheetActions>
          <Button variant="text" onClick={() => setRemoving(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => { if (removing) removeSchedule(removing.id); setRemoving(null); }}>Remove</Button>
        </SheetActions>
      </Dialog>
    </>
  );
}

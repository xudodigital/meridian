import { Button, Chip, Info, ModTable, Pill, Select, SiteChip, Switch, Table } from '@/components';
import { CADS, NEXT, WF_STEPS, inSite, siteById } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Cadence, Schedule, WorkflowRun } from '@/store/types';
import { LiveWorkflows } from './workflows/LiveWorkflows';

const CAD_OPTIONS = CADS.map(x => ({ value: x, label: x }));
const isCadence = (v: string): v is Cadence => CADS.some(x => x === v);

/** The two sequences as plain reference: they describe the order of work and are not controls. */
function Templates({ note }: { note?: string }) {
  return (
    <section>
      <h2>Templates</h2>
      <dl className="reflist">
        <div><dt>New site</dt><dd>{WF_STEPS.join(' → ')}</dd></div>
        <div><dt>Weekly content</dt><dd>Starts at Keywords and repeats every week. Review and Deploy pause for a person's approval.</dd></div>
      </dl>
      {note ? <p className="note">{note}</p> : null}
    </section>
  );
}

/**
 * The Workflows tab of Build and deploy: running workflows, site builds, schedules, templates. Prototype: vWorkflows(), lines 1513-1521. Slice: sites.
 * Outside demo mode the runs and schedules are the server's workflow engine (views/workflows/LiveWorkflows.tsx): real
 * runs with their steps and what each waits for, and schedules that start them. Demo mode keeps the prototype's screen.
 */
export function Workflows() {
  const factoryNote = useStore(s => s.mod.factory.d);
  const sample = useStore(s => s.sample);
  const country = useStore(s => s.sites[0]?.country);
  if (!sample) return <LiveWorkflows />;
  return (
    <>
      <p className="lede">A workflow is a fixed sequence the Orchestrator runs, the same for every site.</p>
      <section><h2>Running now</h2><RunningTable /></section>
      <section><h2>Site builds</h2><ModTable id="factory" /><p className="note">{factoryNote} Each row is one site moving through the "New site" workflow.</p></section>
      <section>
        <h2>Schedules</h2>
        <SchedulesTable />
        <Info label="About schedule times"><p>Times are local to each site's country{country ? `, so "Monday 06:00" for a site in ${country} is Monday morning in ${country}` : ''}. The weekly report has its own schedule in Reports.</p></Info>
      </section>
      <Templates />
    </>
  );
}

function RunningTable() {
  const [runs, sites, siteFilter] = useStoreShallow(s => [s.runs, s.sites, s.siteFilter] as const);
  const advance = useStore(s => s.advanceRun);
  /* The index into `runs` is what the Advance button acts on, as the prototype's data-i. */
  const rows = runs.map((r, i) => [r, i] as const).filter(([r]) => siteById({ sites }, r.site) && inSite({ siteFilter }, r.site)).map(([r, i]) => [
    <><b>{r.name}</b><br /><SiteChip id={r.site} /></>,
    <Steps run={r} />,
    r.step >= WF_STEPS.length - 1 ? <Pill kind="ok">Complete</Pill>
      : siteById({ sites }, r.site)?.status === 'dns' ? <span className="note">Verify DNS first</span>
      : <Button size="sm" variant="text" onClick={() => advance(i)}>Advance</Button>,
  ]);
  return <Table cols={['Workflow', 'Steps', 'Actions']} rows={rows} empty={runs.length ? undefined : 'No workflows are running. One is listed here from its first step to its last while agents work through it.'} />;
}

function Steps({ run }: { run: WorkflowRun }) {
  return <ol className="steps">{WF_STEPS.map((s, j) => <li key={s} className={j < run.step ? 'done' : j === run.step ? 'now' : ''}>{s}</li>)}</ol>;
}

function SchedulesTable() {
  const [schedules, siteFilter] = useStoreShallow(s => [s.schedules, s.siteFilter] as const);
  const list = schedules.filter(c => !c.site || inSite({ siteFilter }, c.site));
  return <Table cols={['Workflow', 'Site', 'Runs', 'Next run', 'On', 'Actions']} rows={list.map(scheduleRow)} rowKey={(_, i) => list[i].id} empty="No schedules yet. A workflow that repeats for a site is listed here with its cadence." />;
}

function scheduleRow(c: Schedule) {
  return [
    <b>{c.wf}</b>,
    c.site ? <SiteChip id={c.site} /> : <Chip>All sites</Chip>,
    <CadenceSelect c={c} />,
    c.on ? NEXT[c.cad] : 'Paused',
    <ScheduleSwitch c={c} />,
    <RunNow id={c.id} />,
  ];
}

function CadenceSelect({ c }: { c: Schedule }) {
  const setCadence = useStore(s => s.setCadence);
  return <Select id={'cad-' + c.id} label={'Schedule for ' + c.wf} value={c.cad} options={CAD_OPTIONS} onChange={v => { if (isCadence(v)) setCadence(c.id, v); }} />;
}

function ScheduleSwitch({ c }: { c: Schedule }) {
  const setOn = useStore(s => s.setScheduleOn);
  return <Switch id={'sch-' + c.id} checked={c.on} label={'Enable ' + c.wf} onChange={v => setOn(c.id, v)} />;
}

function RunNow({ id }: { id: string }) {
  const run = useStore(s => s.runSchedule);
  return <Button size="sm" variant="text" onClick={() => { void run(id); }}>Run now</Button>;
}

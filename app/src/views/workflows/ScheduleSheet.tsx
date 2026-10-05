/* "New schedule" and "Edit schedule": when "Weekly content" starts by itself for a site. Outside demo mode only. The
   schedule is saved in the workspace (the `schedules` document); the server's scheduler reads it every minute. */
import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Select, Sheet, SheetActions } from '@/components';
import { N_DEFAULT, N_MAX, N_MIN, WEEKDAYS, cadenceText, hourText, realSchedule } from '@/store/liveWorkflows';
import { siteById } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Schedule, ScheduleEvery } from '@/store/types';

export const EVERY_OPTIONS: readonly { value: ScheduleEvery; label: string }[] = [
  { value: 'week', label: 'Every week' }, { value: '2weeks', label: 'Every 2 weeks' }, { value: 'month', label: 'Once a month (the first such weekday)' },
];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map(d => ({ value: String(d), label: WEEKDAYS[d]! }));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourText(h) }));
export const N_OPTIONS = Array.from({ length: N_MAX - N_MIN + 1 }, (_, i) => ({ value: String(N_MIN + i), label: `${N_MIN + i} article${N_MIN + i === 1 ? '' : 's'}` }));
const isEvery = (v: string): v is ScheduleEvery => EVERY_OPTIONS.some(o => o.value === v);

/** `edit` is the schedule being changed, 'new' for a new one, null while closed. */
export function ScheduleSheet({ edit, onClose }: { edit: Schedule | 'new' | null; onClose: () => void }) {
  return (
    <Sheet open={edit !== null} onClose={onClose} labelledBy="wfSchT">
      {edit !== null ? <ScheduleForm edit={edit === 'new' ? null : edit} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ScheduleForm({ edit, onClose }: { edit: Schedule | null; onClose: () => void }) {
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const saveSchedule = useStore(s => s.saveSchedule);
  const real = edit && realSchedule(edit) ? edit : null;
  const [site, setSite] = useState(edit?.site ?? (siteById({ sites }, siteFilter)?.id ?? sites[0]?.id ?? ''));
  const [every, setEvery] = useState<ScheduleEvery>(real?.every ?? 'week');
  const [weekday, setWeekday] = useState(real?.weekday ?? 1);
  const [hour, setHour] = useState(real?.hour ?? 6);
  const [n, setN] = useState(edit?.n ?? N_DEFAULT);
  const [topic, setTopic] = useState(edit?.topic ?? '');
  const [msg, setMsg] = useState('');
  const at = siteById({ sites }, site);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = saveSchedule({ ...(edit ? { id: edit.id } : {}), site, every, weekday, hour, n, topic });
    if (err) setMsg(err); else if (err === null) onClose();
  };
  return (
    <form onSubmit={submit}>
      <h2 id="wfSchT">{edit ? 'Edit schedule' : 'New schedule'}</h2>
      <p>Runs keyword research and article drafts weekly. Publication still needs your review and approval.</p>
      <Fields>
        <Field label="Site" wide>
          <Select id="wfSchSite" label="Site" value={site} onChange={setSite} options={sites.map(s => ({ value: s.id, label: `${s.domain} (${s.country})` }))} />
        </Field>
        <Field label="How often">
          <Select id="wfSchEvery" label="How often" value={every} onChange={v => { if (isEvery(v)) setEvery(v); }} options={EVERY_OPTIONS} />
        </Field>
        <Field label="Weekday">
          <Select id="wfSchDay" label="Weekday" value={String(weekday)} onChange={v => setWeekday(Number(v))} options={DAY_OPTIONS} />
        </Field>
        <Field label="Time">
          <Select id="wfSchHour" label="Time" value={String(hour)} onChange={v => setHour(Number(v))} options={HOUR_OPTIONS} searchPlaceholder="Hour" />
        </Field>
        <Field label="Articles per run">
          <Select id="wfSchN" label="Articles per run" value={String(n)} onChange={v => setN(Number(v))} options={N_OPTIONS} />
        </Field>
        <Field label="Research topic (optional)" wide>
          <input id="wfSchTopic" type="text" maxLength={80} autoComplete="off" placeholder={at?.topic ? `The site's topic: ${at.topic}` : 'The site has no topic yet: enter one'} value={topic} onChange={e => setTopic(e.target.value)} />
        </Field>
      </Fields>
      <p className="note" id="wfSchWhen">{cadenceText({ every, weekday, hour })}{at ? `, on the clock of ${at.country}` : ''}. Each run is paid agent work and keeps to the site's daily budget.</p>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={!sites.length}>{edit ? 'Save schedule' : 'Add schedule'}</Button>
      </SheetActions>
    </form>
  );
}

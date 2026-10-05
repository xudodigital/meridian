import { useState } from 'react';
import { Field, Fields, Select, SwitchRow } from '@/components';
import { dayTime } from '@/store/rules';
import { usableInt } from '@/store/serverFacts';
import { NO_EMAIL } from '@/store/slices/content';
import { useStore } from '@/store/store';

const FREQS = ['Every Monday 08:00', 'Every day 08:00', 'First day of the month'];

/**
 * "Scheduled delivery" on Reports: the prototype's data-set controls repOn, repTo and repFreq (change handler, line
 * 2189). Outside demo mode the server sends the report on that schedule, from Email (SMTP) in Integrations.
 */
export function Delivery({ lastSent = null }: { lastSent?: { at: number; to: string[]; by: string } | null }) {
  const repOn = useStore(s => s.settings.repOn);
  const repTo = useStore(s => s.settings.repTo);
  const repFreq = useStore(s => s.settings.repFreq);
  const setReportSetting = useStore(s => s.setReportSetting);
  const sample = useStore(s => s.sample);
  const emailOk = useStore(s => s.sample || usableInt(s, 'email'));
  /* The recipients field commits like the prototype's change event: on blur or Enter, not on every key. */
  const [to, setTo] = useState<string | null>(null);
  const commitTo = () => {
    if (to === null) return;
    if (to !== repTo) setReportSetting('repTo', to);
    setTo(null);
  };

  return (
    <section>
      <h2>Scheduled delivery</h2>
      <SwitchRow id="st-repOn" checked={repOn && emailOk} disabled={!emailOk} onChange={v => setReportSetting('repOn', v)}>Email this report automatically</SwitchRow>
      <Fields>
        <Field label="Recipients, separated by commas" wide>
          <input type="text" id="st-repTo" value={to ?? repTo} onChange={e => setTo(e.target.value)} onBlur={commitTo}
            onKeyDown={e => { if (e.key === 'Enter') commitTo(); }} />
        </Field>
        <Field label="How often">
          <Select id="st-repFreq" label="How often" value={repFreq} options={FREQS.map(x => ({ value: x, label: x }))} onChange={v => setReportSetting('repFreq', v)} />
        </Field>
      </Fields>
      <p className="note">
        {sample ? 'In demo mode nothing is sent and export is copy-only. Sending would attach a PDF and a CSV to the email.'
          : !emailOk ? NO_EMAIL
          : 'The report goes out at 08:00 on this computer\'s clock, with the figures as a CSV attachment. Meridian must be running at that time; a report more than 12 hours late is skipped.'}
        {lastSent ? ` Last sent ${dayTime(lastSent.at)} to ${lastSent.to.join(', ')}${lastSent.by && lastSent.by !== 'Schedule' ? ' by ' + lastSent.by : lastSent.by === 'Schedule' ? ' on schedule' : ''}.` : ''}
      </p>
    </section>
  );
}

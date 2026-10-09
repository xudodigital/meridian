import { Field, Fields, Info, Select, SwitchRow } from '@/components';
import { showBudget } from '@/store/rules';
import { useStore } from '@/store/store';
import type { SystemSettingKey } from '@/store/slices/system';
import type { QuietId, Settings as SettingsT, TimeoutId } from '@/store/types';
import { AlertTable } from './system/AlertTable';
import { RecentAlerts } from './system/RecentAlerts';
import { NumberSetting } from './system/NumberSetting';
import { ResetWorkspace } from './system/ResetWorkspace';
import { SessionList } from './system/SessionList';
import { SystemCard } from './system/SystemCard';

type BoolKey = { [K in SystemSettingKey]: SettingsT[K] extends boolean ? K : never }[SystemSettingKey];

const QUIET: readonly { value: QuietId; label: string }[] = [
  { value: 'none', label: 'No quiet hours' }, { value: 'night', label: '22:00 to 07:00' }, { value: 'weekend', label: 'Nights and weekends' },
];
const TIMEOUT: readonly { value: TimeoutId; label: string }[] = [
  { value: 'demo', label: '1 minute (to try it now)' }, { value: 'm15', label: '15 minutes' }, { value: 'h1', label: '1 hour' }, { value: 'h8', label: '8 hours' },
];
/** "1 minute" is for trying the idle sign-out in a demonstration: outside demo mode it is offered only while it is the saved value. */
const timeouts = (sample: boolean, current: TimeoutId) => TIMEOUT.filter(o => o.value !== 'demo' || sample || current === 'demo');

/**
 * Settings: limits, approval rules, alerts, sign-in security (enforced by the server), demo mode and Reset workspace.
 * Prototype: vSettings(), lines 1659-1673. Slice: system. Outside demo mode only settings the server acts on are
 * shown: "Maximum parallel workers" and "Require approval before content publishes" belong to the demo simulation
 * (the server runs one job at a time, and nothing reaches a site without an approved article and website build).
 */
export function Settings() {
  const costs = useStore(showBudget);
  const settings = useStore(s => s.settings);
  const setSystemSetting = useStore(s => s.setSystemSetting);
  const admin = useStore(s => s.session?.role === 'admin');
  const sample = useStore(s => s.sample);
  const sw = (k: BoolKey, text: string) => <SwitchRow id={'st-' + k} checked={settings[k]} onChange={v => setSystemSetting(k, v)}>{text}</SwitchRow>;
  const setQuiet = (v: string) => { const o = QUIET.find(x => x.value === v); if (o) setSystemSetting('quiet', o.value); };
  const setTimeoutId = (v: string) => { const o = TIMEOUT.find(x => x.value === v); if (o) setSystemSetting('timeout', o.value); };
  return (
    <>
      <p className="lede">{costs ? 'Budgets, approvals, alerts and account security.' : 'Approvals, alerts and account security.'}</p>
      {costs ? <section>
        <h2>Limits</h2>
        <Fields>
          <NumberSetting k="budget" label="Daily budget per site (USD)" />
          {sample ? <NumberSetting k="parallel" label="Maximum parallel workers" /> : null}
        </Fields>
        {sample ? null : <p className="note">{'New jobs pause when the daily limit is reached.'}</p>}
        {sample ? null : <Info label="Budget rules"><p>Waiting jobs resume at local midnight or when you raise the limit. Alerts appear at 80% and when work stops. Jobs run one at a time. The limit checks spend before a job starts; a call already running can exceed the remaining budget. Provider invoices remain authoritative.</p></Info>}
      </section> : null}
      <section>
        <h2>Human approval</h2>
        {sample ? sw('apPublish', 'Require approval before content publishes') : <p className="note">Articles always need human approval before a build.</p>}
        {sw('apDeploy', 'Require approval before a deploy')}
        {sw('native', 'Require native-speaker review before an article can be approved')}
      </section>
      <section>
        <h2>Notifications</h2>
        <p className="note">{sample ? 'Choose where each alert goes. Slack and Telegram need a connection in Integrations first.' : 'Choose alert channels. Connect them in Integrations first.'}</p>
        <AlertTable />
        <Fields>
          <Field label="Quiet hours for email, Slack and Telegram"><Select id="st-quiet" label="Quiet hours for email, Slack and Telegram" value={settings.quiet} options={QUIET} onChange={setQuiet} /></Field>
        </Fields>
        {sample ? null : <p className="note">Alerts wait until quiet hours end. Uses local time.</p>}
        {sample || !admin ? null : <><p className="subh">Recently sent</p><RecentAlerts /></>}
      </section>
      <section>
        <h2>Sign-in security</h2>
        {sw('twofa', 'Require a 2-step verification code at sign-in')}
        <p className="note">When enabled, requires setup at the next sign-in.</p>
        <Fields>
          <Field label="Sign out after inactivity"><Select id="st-timeout" label="Sign out after inactivity" value={settings.timeout} options={timeouts(sample, settings.timeout)} onChange={setTimeoutId} /></Field>
        </Fields>
        <p className="subh">Your sessions</p>
        <SessionList />
      </section>
      {admin && !sample ? <SystemCard /> : null}
      {admin && !sample ? <WorkspaceReset /> : null}
    </>
  );
}

/** The administrator can reset workspace configuration through the existing guarded flow. */
function WorkspaceReset() {
  return <section>
    <h2>Reset workspace</h2>
    <p className="note">Resets workspace configuration for everyone. Accounts, articles and history stay.</p>
    <ResetWorkspace />
  </section>;
}

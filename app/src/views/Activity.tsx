import { Tabs } from '@/components';
import { ACTABS } from '@/store/constants';
import { activityTabs } from '@/store/rules';
import { useStore } from '@/store/store';
import { Audit } from './Audit';
import { History } from './History';

/**
 * Activity: the two chronological logs under one title. Runs is every job an agent finished (the run history), Audit
 * log is who did what. A role sees the tabs it may open (rules.ts activityTabs); with only one of them there is no
 * tab row, just that log. The tab is remembered in the store (actab) and each has a URL: /history and /audit.
 */
export function Activity() {
  const session = useStore(s => s.session);
  const actab = useStore(s => s.actab);
  const setActab = useStore(s => s.setActab);
  const allowed = activityTabs(session);
  const tab = allowed.includes(actab) ? actab : allowed[0];
  return (
    <>
      {allowed.length > 1 ? <Tabs label="Activity sections" value={tab ?? actab} onChange={setActab} items={ACTABS.filter(t => allowed.includes(t[0])).map(([id, label]) => ({ id, label }))} /> : null}
      {tab === 'runs' ? <History /> : tab === 'audit' ? <Audit /> : null}
    </>
  );
}

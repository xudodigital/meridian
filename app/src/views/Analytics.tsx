import { Tabs } from '@/components';
import { ATABS } from '@/store/constants';
import { useStore } from '@/store/store';
import { Rank } from './Rank';
import { Reports } from './Reports';
import { Overview } from './analytics/Overview';
import { SourceTab } from './system/SourceTab';

/** Analytics: Overview (views/analytics), Search Console, GA4, Rank and Reports tabs (the last two were screens of their own). Slice: system. */
export function Analytics() {
  const atab = useStore(s => s.atab);
  const setAtab = useStore(s => s.setAtab);
  return (
    <>
      <Tabs label="Analytics sections" value={atab} onChange={setAtab} items={ATABS.map(([id, label]) => ({ id, label }))} />
      {atab === 'overview' ? <Overview /> : atab === 'rank' ? <Rank /> : atab === 'reports' ? <Reports /> : <SourceTab id={atab} />}
    </>
  );
}

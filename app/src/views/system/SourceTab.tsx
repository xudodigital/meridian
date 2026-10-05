import { ModTable } from '@/components';
import { useStore } from '@/store/store';
import { ModLede, SourceCallout } from '../research/ModPage';
import { Ga4 } from './Ga4';
import { SearchConsole } from './SearchConsole';

/**
 * The Search Console and GA4 tabs of Analytics. Demo mode keeps the prototype's vTable('gsc' / 'ga4'), lines
 * 1582-1590; otherwise the tabs show what the server read from the connected Google account (SearchConsole, Ga4).
 */
export function SourceTab({ id }: { id: 'gsc' | 'ga4' }) {
  const sample = useStore(s => s.sample);
  if (!sample) return <><ModLede id={id} />{id === 'gsc' ? <SearchConsole /> : <Ga4 />}</>;
  return (
    <>
      <ModLede id={id} />
      <SourceCallout need={id} />
      <section><ModTable id={id} /></section>
    </>
  );
}

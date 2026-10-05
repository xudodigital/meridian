import { useState } from 'react';
import { OperationScene } from './visual/OperationScene';
import { Button, Empty, ModTable, SearchField, Select, Tabs } from '@/components';
import { ACC, SST, siteStatusText } from '@/store/rules';
import type { SitesMode, SitesStatusFilter } from '@/store/slices/sites';
import { useStore, useStoreShallow } from '@/store/store';
import type { SiteStatus } from '@/store/types';
import { AddSiteSheet } from './sites/AddSiteSheet';
import { SitesMap } from './sites/SitesMap';
import { SitesTable } from './sites/SitesTable';

const MODES: readonly { id: SitesMode; label: string; icon: string }[] = [
  { id: 'list', label: 'List', icon: 'table_rows' },
  { id: 'map', label: 'Map', icon: 'public' },
  { id: 'themes', label: 'Themes', icon: 'palette' },
];
const STATUS_IDS = Object.keys(SST) as SiteStatus[];
/**
 * The status filter, in the same words as the pills (rules.ts siteStatusText and ACC). Outside demo mode there is no
 * "Waiting for DNS": a person picks "Being set up" or "Already live" when adding a domain.
 */
const statusOptions = (sample: boolean): { value: SitesStatusFilter; label: string }[] => [
  { value: '', label: 'Any status' },
  ...STATUS_IDS.filter(k => sample || k !== 'dns').map(k => ({ value: k, label: siteStatusText(k, sample) })),
  { value: 'blocked', label: ACC.blocked[1] },
];
const isStatusFilter = (v: string): v is SitesStatusFilter => v === '' || v === 'blocked' || (STATUS_IDS as string[]).includes(v);

/** Sites: list, map and themes. Prototype: vSites() and helpers, lines 1446-1512. Slice: sites. */
export function Sites() {
  const [sites, smode, sample] = useStoreShallow(s => [s.sites, s.smode, s.sample] as const);
  const setSmode = useStore(s => s.setSmode);
  const guard = useStore(s => s.guard);
  const [adding, setAdding] = useState(false);

  /* Themes are listed in demo mode only: nothing fills the table outside it yet. */
  const modes = sample ? MODES : MODES.filter(m => m.id !== 'themes');
  const mode: SitesMode = modes.some(m => m.id === smode) ? smode : 'list';

  return (
    <>
      <div className="sh">
        <p className="lede">One domain per country, each with its own profile and data.</p>
        <Button variant="filled" icon="add" onClick={() => { if (guard()) setAdding(true); }}>Add domain</Button>
      </div>
      <OperationScene kind="sites" />
      {sites.length ? <Tabs label="How sites are shown" value={mode} onChange={setSmode} items={modes} /> : null}
      {!sites.length ? <NoSites onAdd={() => { if (guard()) setAdding(true); }} /> : mode === 'map' ? <SitesMap /> : mode === 'themes' ? <ThemesSection /> : <ListSection />}
      <AddSiteSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function ThemesSection() {
  const d = useStore(s => s.mod.themes.d);
  return <section><p className="note">{d}</p><ModTable id="themes" /></section>;
}

/** No site at all: show the next step beneath the visual overview. */
function NoSites({ onAdd }: { onAdd: () => void }) {
  return (
    <section>
      <Empty icon="language" title="No sites yet" action={<Button variant="filled" icon="add" onClick={onAdd}>Add your first domain</Button>}>
        Add your first domain to get started. Agents work for one site at a time, in its country and language.
      </Empty>
    </section>
  );
}

function ListSection() {
  const [sites, sq, sst, sco, sample] = useStoreShallow(s => [s.sites, s.sq, s.sst, s.sco, s.sample] as const);
  const setFilter = useStore(s => s.setSitesFilter);
  const countries = [...new Set(sites.map(s => s.country))].sort();
  const STATUS_OPTIONS = statusOptions(sample);
  return (
    <section>
      <div className="toolbar">
        <SearchField id="sq" label="Search sites" placeholder="Search by domain, country or topic" value={sq} onChange={e => setFilter({ sq: e.target.value })} />
        <Select id="sf-st" label="Status" value={sst} options={STATUS_OPTIONS} onChange={v => { if (isStatusFilter(v)) setFilter({ sst: v }); }} />
        <Select id="sf-co" label="Country" searchPlaceholder="Search countries" value={sco}
          options={[{ value: '', label: 'Any country' }, ...countries.map(x => ({ value: x, label: x }))]} onChange={v => setFilter({ sco: v })} />
      </div>
      <div id="sitesTbl"><SitesTable /></div>
    </section>
  );
}

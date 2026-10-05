import { SeoTasks } from './research/SeoTasks';
import { useState } from 'react';
import { OperationScene } from './visual/OperationScene';
import { ModTable, SearchField, Tabs } from '@/components';
import { RTABS } from '@/store/constants';
import { siteShown } from '@/store/rules';
import { useStore } from '@/store/store';
import { Architecture } from './Architecture';
import { Experiments } from './Experiments';
import { Links } from './Links';
import { KwRequests } from './research/KwRequests';
import { ModLede, ModSection } from './research/ModPage';

/** Research and SEO: eight tabs (Research, Keywords, SEO/GEO, AI Overview, Calls to action, Architecture, Internal links, Experiments; the last three were screens of their own). Prototype: tabsHTML('rctab') + vTable(state.rctab) and kwReqHTML(), lines 1567-1590, 2230-2237. */
export function Research() {
  const real = useStore(s => s.live.on && !s.sample);
  const tab = useStore(s => s.rctab);
  const setTab = useStore(s => s.setRctab);
  return (
    <>
      <Tabs label="Research and SEO sections" value={tab} onChange={setTab} items={RTABS.map(([id, label]) => ({ id, label }))} />
      {real && (tab === 'research' || tab === 'seo') ? <SeoTasks key={tab} initialKind={tab === 'seo' ? 'audit' : 'strategy'} /> : tab === 'architecture' ? <Architecture />
        : tab === 'links' ? <Links />
        : tab === 'experiments' ? <Experiments />
        : <><ModLede id={tab} />{tab === 'keywords' ? <><OperationScene kind="research" /><KwRequests /><KeywordTable /></> : <ModSection id={tab} />}</>}
    </>
  );
}

/** The keyword table under its own heading (B15), with the count inside the site filter and a search box once it is long. */
function KeywordTable() {
  const n = useStore(s => s.mod.keywords.rows.filter(r => siteShown(s, r.s, r.domain)).length);
  const [q, setQ] = useState('');
  return (
    <section>
      <div className="sh">
        <h2>Keywords{n ? ` (${n})` : ''}</h2>
        {n > 8 ? <SearchField id="kwq" label="Search keywords" placeholder="Search keywords, intent or cluster" value={q} onChange={e => setQ(e.target.value)} /> : null}
      </div>
      <ModTable id="keywords" query={q} />
    </section>
  );
}

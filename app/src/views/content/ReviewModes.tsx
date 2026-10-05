import { Pager, Select, SiteChip, Table, usePaged } from '@/components';
import { MODES } from '@/store/constants';
import { inSite } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { ReviewMode, Site } from '@/store/types';

const MODE_IDS = Object.keys(MODES) as ReviewMode[];
const OPTIONS = MODE_IDS.map(k => ({ value: k, label: MODES[k] }));
const isMode = (v: string): v is ReviewMode => (MODE_IDS as string[]).includes(v);

/** "Review mode by site" (vReview, line 1431): one review mode per site, paged under the key "modes". */
export function ReviewModes() {
  const [sites, articles, siteFilter] = useStoreShallow(s => [s.sites, s.articles, s.siteFilter] as const);
  const setSiteReviewMode = useStore(s => s.setSiteReviewMode);
  const pg = usePaged<Site>('modes', sites.filter(s => inSite({ siteFilter }, s.id)));
  return (
    <section>
      <h2>Review mode by site</h2>
      <Table
        cols={['Site', 'Mode', 'Waiting']}
        num={[2]}
        empty={sites.length ? undefined : 'No sites yet. Add a domain in Sites, then choose here how its articles are reviewed.'}
        rowKey={(_, i) => pg.rows[i]?.id ?? i}
        rows={pg.rows.map(s => [
          <SiteChip id={s.id} />,
          <Select id={'mode-' + s.id} label={'Review mode for ' + s.domain} value={s.mode || 'all'} options={OPTIONS}
            onChange={v => { if (isMode(v)) setSiteReviewMode(s.id, v); }} />,
          String(articles.filter(a => a.s === s.id && a.status === 'review').length),
        ])}
      />
      <Pager pkey="modes" paged={pg} />
      <p className="note">In sample and risk-based modes, some articles publish without a person reading them. Those are still recorded in the audit log.</p>
    </section>
  );
}

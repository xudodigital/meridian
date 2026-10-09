import { useState } from 'react';
import { Button, Empty, Pager, Pill, usePaged } from '@/components';
import { domainNote, domainOf } from '@/store/domains';
import { ACC, SST, showCosts, siteStatusText } from '@/store/rules';
import { budgetUsed, usd } from '@/store/spend';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';
import { sitesFiltered } from './filter';
import { VerifySheet } from './VerifySheet';

/** The prototype's sitesTable(): the filtered sites, 12 per page, with verify, pause/resume and remove. */
export function SitesTable() {
  const [sites, siteFilter, sq, sst, sco, sample] = useStoreShallow(s => [s.sites, s.siteFilter, s.sq, s.sst, s.sco, s.sample] as const);
  const setFilter = useStore(s => s.setSitesFilter);
  const list = sitesFiltered(sites, { siteFilter, sq, sst, sco });
  const pg = usePaged('sites', list, 12);
  const [verifying, setVerifying] = useState<string | null>(null);
  /* Spend today per site: the simulation's in demo mode, otherwise the sum of the server's spend ledger (store/spend.ts).
     The column is left out until the server has sent it, instead of showing $0.00 that is not measured. */
  const measured = useStore(s => s.live.spend !== null);
  const costs = useStore(showCosts);
  const spend = costs && (sample || measured);
  if (!list.length) {
    return (
      <Empty icon="filter_alt_off" title="No sites match these filters" action={<Button variant="tonal" onClick={() => setFilter({ sq: '', sst: '', sco: '' })}>Clear filters</Button>}>
        Try another search, status or country.
      </Empty>
    );
  }
  return (
    <>
      <div className="scroll wide">
        <table>
          <thead><tr><th>Site</th><th>Country</th><th>Status</th><th title="Access from inside the site's country">Access</th>{spend ? <th title="What the agents spent for this site today, against the daily budget">Spend today</th> : null}<th>Last deploy</th><th>Actions</th></tr></thead>
          <tbody>{pg.rows.map(s => <SiteRow key={s.id} s={s} spend={spend} onVerify={setVerifying} />)}</tbody>
        </table>
      </div>
      <Pager pkey="sites" paged={pg} />
      <VerifySheet siteId={verifying} onClose={() => setVerifying(null)} />
    </>
  );
}

function SiteRow({ s, spend, onVerify }: { s: Site; spend: boolean; onVerify: (id: string) => void }) {
  const verifySite = useStore(st => st.verifySite);
  const pauseSite = useStore(st => st.pauseSite);
  const openConfirm = useStore(st => st.openConfirm);
  const sample = useStore(st => st.sample);
  const guard = useStore(st => st.guard);
  /* Outside demo mode: whether the owner proved control of the domain with a DNS TXT record. */
  const owned = useStore(st => st.sample ? undefined : st.live.verify[s.id]);
  /* Outside demo mode: where the site's own domain is on Cloudflare Pages, while it is not live there yet. */
  const domain = useStore(st => st.sample ? '' : domainNote(domainOf(st.live.domains, s)));
  const [stKind] = SST[s.status], [acKind, acText] = ACC[s.access];
  /* The server stops a site's agent jobs once its spend today reaches the daily budget. */
  const stopped = useStore(st => budgetUsed(st, s.id));
  return (
    <tr>
      <td>
        <div className="sname">
          <span className="cc sm" aria-hidden="true">{s.cc}</span>
          <div>
            <b>{s.domain}</b><span className="note">{s.topic}</span>
            {s.status === 'dns' ? <><br /><span className="note">Add TXT <code>_agent-verify</code> = <code>{s.token}</code></span></> : null}
            {owned && owned.domain === s.domain ? <><br />{owned.verifiedAt ? <Pill kind="ok">Owner verified</Pill> : <span className="note">Ownership not verified</span>}</> : null}
          </div>
        </div>
      </td>
      <td data-label="Country"><span>{s.country} · <span className="note">{s.lang}</span></span></td>
      <td data-label="Status"><Pill kind={stKind} live={s.status === 'build' && sample}>{siteStatusText(s.status, sample)}</Pill>{domain ? <><br /><span className="note">{domain}</span></> : null}</td>
      <td data-label="Access"><Pill kind={acKind}>{acText}</Pill></td>
      {spend ? <td className="n" data-label="Spend today">{usd(s.spend)}{stopped ? <> <Pill kind="bad">Budget used</Pill></> : null}</td> : null}
      <td data-label="Last deploy">{s.deploy}</td>
      <td data-label="Actions">
        <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
          {s.status === 'dns'
            ? <Button size="sm" variant="tonal" onClick={() => verifySite(s.id)}>Verify DNS</Button>
            : <Button size="sm" variant="text" onClick={() => pauseSite(s.id)}>{s.status === 'paused' ? 'Resume' : 'Pause'}</Button>}
          {owned && owned.domain === s.domain && !owned.verifiedAt ? <Button size="sm" variant="text" onClick={() => { if (guard()) onVerify(s.id); }}>Verify</Button> : null}
          <Button size="sm" variant="danger" aria-label={'Remove ' + s.domain} onClick={() => openConfirm(`site:${s.id}`)}>Remove</Button>
        </div>
      </td>
    </tr>
  );
}

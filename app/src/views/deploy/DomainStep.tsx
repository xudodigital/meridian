/* The "Domain" step of a site's Website card, outside demo mode: where the site's own domain is on its way to its
   Cloudflare Pages project (Not attached → Waiting for DNS → Issuing certificate → Live), what the server says about it
   in plain words, the DNS record to add when the DNS is not Meridian's to change, and "Check again". Everything shown
   is the server's record (server/domains.ts); a site without one is not attached yet. */
import { Button, Icon, Pill, cx } from '@/components';
import { DOMAIN_STEPS, domainOf, domainStep, domainsApi, liveDomainTo } from '@/store/domains';
import { dayTime } from '@/store/rules';
import { useStore } from '@/store/store';
import type { BuildWire, DomainWire, Site } from '@/store/types';
import { useOneAtATime, type CfState } from './parts';

/** A record's name as most DNS providers want it typed: without the zone, "@" for the bare domain. Shown as a hint. */
function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const snack = useStore(s => s.snack);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => snack('Copied'), () => undefined); };
  return (
    <tr>
      <th scope="row">{label}</th>
      <td><code>{value}</code>{hint ? <span className="note"> {hint}</span> : null}</td>
      <td><Button size="sm" variant="text" aria-label={`Copy ${label.toLowerCase()}`} onClick={copy}>Copy</Button></td>
    </tr>
  );
}

/** The record the person adds at their DNS provider (or puts right in Cloudflare DNS). */
function RecordTable({ d }: { d: DomainWire }) {
  if (!d.record && !d.txt) return null;
  return (
    <div className="scroll">
      <table className="web-dom-rec" aria-label={`DNS record${d.record && d.txt ? 's' : ''} for ${d.domain}`}>
        <tbody>
          {d.record ? (
            <>
              <tr><th scope="row">Type</th><td><code>{d.record.type}</code></td><td /></tr>
              <CopyRow label="Name" value={d.record.name} />
              <CopyRow label="Target" value={d.record.content} />
              <tr><th scope="row">Proxy</th><td>{d.record.proxied ? 'Proxied (orange cloud) when the DNS is at Cloudflare' : 'DNS only'}</td><td /></tr>
            </>
          ) : null}
          {d.txt ? (
            <>
              <tr><th scope="row">Type</th><td><code>TXT</code></td><td /></tr>
              <CopyRow label="TXT name" value={d.txt.name} />
              <CopyRow label="TXT value" value={d.txt.value} />
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function DomainStep({ site, live, cf, write }: { site: Site; live: BuildWire | undefined; cf: CfState; write: boolean }) {
  const d = useStore(s => domainOf(s.live.domains, site));
  const snack = useStore(s => s.snack);
  const [busy, run] = useOneAtATime();
  /* Nothing to say about a domain before the site was ever deployed and before the server has a record of it. */
  if (!d && !live) return null;
  const step = domainStep(d), failed = d?.status === 'error';
  const pagesUrl = d?.pagesUrl || (live && /^https:\/\//i.test(live.deployUrl) ? live.deployUrl : '');
  const check = () => run(async () => {
    try {
      const next = await domainsApi.check(site.id);
      useStore.setState(s => { liveDomainTo(s, next); });
      snack(next.status === 'live' ? `${site.domain} is live.` : 'Checked again. ' + next.message, next.status === 'error' ? 'error' : 'dns');
    } catch (e) { snack((e as Error).message, 'error'); }
  });
  const message = d ? d.message
    : cf === 'ok' ? `${site.domain} is not connected to the Pages project yet.`
      : `${site.domain} is not connected yet. Connect Cloudflare in Integrations to attach it.`;
  return (
    <section className="web-domain" aria-label={`Domain of ${site.domain}`}>
      <div className="web-dom-head">
        <b>Domain</b>
        <ol className="web-dom-steps" aria-label="Domain steps">
          {DOMAIN_STEPS.map((label, i) => (
            <li key={label} className={cx(i < step && 'done', i === step && (failed ? 'bad' : step === 3 ? 'done' : 'now'))} aria-current={i === step ? 'step' : undefined}>
              <span className="web-dom-dot" aria-hidden="true">{i < step || (i === step && step === 3) ? <Icon name="check" /> : i === step && failed ? <Icon name="priority_high" /> : i + 1}</span>
              {i === 3 && step === 3 ? `Live on https://${site.domain}` : label}
            </li>
          ))}
        </ol>
        {failed ? <Pill kind="bad">Needs attention</Pill> : null}
      </div>
      {d?.status === 'live'
        ? <p className="web-dom-msg"><a className="btn text sm" href={`https://${site.domain}`} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" />Open https://{site.domain}</a></p>
        : <p className={cx('web-dom-msg', failed && 'err')} role={failed ? 'alert' : undefined}>{message}</p>}
      {d && d.status !== 'live' ? <RecordTable d={d} /> : null}
      {d?.status !== 'live' && pagesUrl ? (
        <p className="note">The site is being set up on its own domain. Its pages.dev address works already: <a href={pagesUrl} target="_blank" rel="noopener noreferrer">{pagesUrl}</a></p>
      ) : null}
      <div className="web-dom-foot">
        {write && cf === 'ok' && live && d?.status !== 'live'
          ? <Button size="sm" variant="tonal" icon="refresh" disabled={busy} onClick={() => { void check(); }}>{busy ? 'Checking…' : d && d.status !== 'none' ? 'Check again' : 'Connect domain'}</Button>
          : null}
        {d?.checkedAt ? <span className="note">Checked {dayTime(d.checkedAt)}{d.nextCheckAt ? ' · Meridian keeps checking by itself' : ''}</span> : null}
      </div>
    </section>
  );
}

/* Each site's own domain on its Cloudflare Pages project (server/domains.ts), outside demo mode: the server's record
   in the store, the "Check again" call, and the small derivations the Build and deploy and Sites screens share.
   Nothing here invents a state: a site without a record is simply not attached yet. */
import { apiSend } from './serverApi';
import type { DomainWire, LiveState, Site } from './types';

/** One domain as the server now has it (an answer or the event stream). The newest change wins. */
export function liveDomainTo(s: { live: Pick<LiveState, 'domains'> }, d: DomainWire): void {
  const known = s.live.domains[d.siteId];
  if (known && known.updatedAt > d.updatedAt) return;
  s.live.domains[d.siteId] = d;
}

/** The server's record for a site, when it is about the domain the site has now. */
export const domainOf = (domains: Readonly<Record<string, DomainWire>>, site: Pick<Site, 'id' | 'domain'>): DomainWire | undefined => {
  const d = domains[site.id];
  return d && d.domain === site.domain.toLowerCase() ? d : undefined;
};

/** The four steps of the Domain row, in order. */
export const DOMAIN_STEPS = ['Not attached', 'Waiting for DNS', 'Issuing certificate', 'Live'] as const;
/**
 * Which step the domain is on (0 to 3). A problem stays on the step it stops: attaching (the token, a domain another
 * project uses), the DNS (a record someone else made), or the certificate (CAA, validation).
 */
export function domainStep(d: DomainWire | undefined): number {
  if (!d) return 0;
  if (d.status === 'live') return 3;
  if (d.status === 'cert') return 2;
  if (d.status === 'dns') return 1;
  if (d.status === 'error') return d.problem === 'conflict' ? 1 : d.problem === 'caa' || d.problem === 'validation' ? 2 : 0;
  return 0;
}

/** A few words for the Sites table, or '' when there is nothing to add to the status pill. */
export function domainNote(d: DomainWire | undefined): string {
  if (!d) return '';
  switch (d.status) {
    case 'dns': return d.dnsBy === 'you' ? 'Domain: add the DNS record' : 'Domain: waiting for DNS';
    case 'cert': return 'Domain: issuing certificate';
    case 'error': return 'Domain needs attention';
    default: return '';
  }
}

export const domainsApi = {
  /** "Check again": looks at the DNS and asks Cloudflare to validate again; attaches the domain when it is not yet. */
  check: (siteId: string) => apiSend<{ domain?: DomainWire }>(`/api/sites/${encodeURIComponent(siteId)}/domain/check`).then(r => {
    if (!r.domain) throw new Error('The server did not return the domain. Try again.');
    return r.domain;
  }),
};

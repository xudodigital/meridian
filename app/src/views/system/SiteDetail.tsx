import { useState, type ReactNode } from 'react';
import { Button, Select } from '@/components';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';

/**
 * The site whose detail a tab shows: the one in the top-bar site filter, else the one picked here, else `first`
 * (the first site that has figures), else the first site. Null when there are no sites.
 */
export function usePickedSite(first?: (s: Site) => boolean): { site: Site | null; sites: readonly Site[]; pick: (id: string) => void; locked: boolean } {
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const [picked, setPicked] = useState<string | null>(null);
  const filtered = siteFilter === 'all' ? null : sites.find(s => s.id === siteFilter) ?? null;
  const site = filtered ?? sites.find(s => s.id === picked) ?? (first ? sites.find(first) : undefined) ?? sites[0] ?? null;
  return { site, sites, pick: setPicked, locked: !!filtered };
}

/** The heading row of a site's detail: the title, the site picker (when the site filter shows all sites) and actions. */
export function SiteDetailHead({ title, site, sites, pick, locked, children }: { title: string; site: Site; sites: readonly Site[]; pick: (id: string) => void; locked: boolean; children?: ReactNode }) {
  return (
    <div className="sh">
      <h2>{title}</h2>
      <div className="ins-pick">
        {!locked && sites.length > 1 ? <Select label="Site" icon="language" value={site.id} onChange={pick} options={sites.map(s => ({ value: s.id, label: s.domain }))} searchPlaceholder="Search sites" /> : null}
        {children}
      </div>
    </div>
  );
}

/** A "Refresh" button for people who may change things; viewers do not get one. */
export function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const may = useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');
  return may ? <Button variant="tonal" size="sm" icon="refresh" disabled={busy} onClick={onClick}>{busy ? 'Refreshing…' : 'Refresh'}</Button> : null;
}

/** "Open Integrations" for an admin; for everyone else, who to ask. */
export function ConnectAction({ go }: { go: () => void }): ReactNode {
  const admin = useStore(s => s.session?.role === 'admin');
  return admin ? <Button variant="tonal" icon="hub" onClick={go}>Open Integrations</Button> : null;
}

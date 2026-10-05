/* A site's real internal links and categories from the server (GET /api/sites/:id/links, server/links.ts), for the
   Internal links and Architecture tabs and for the article editor's link and category pickers. Nothing is kept in the
   store: the answer is read again whenever one of the site's articles changes (the store hears of that over the event
   stream), so the graph always matches the articles. */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, apiSend } from '@/store/serverApi';
import { useStore } from '@/store/store';
import type { SiteLinksWire } from '@/store/types';

const path = (siteId: string, what: 'links' | 'categories') => `/api/sites/${encodeURIComponent(siteId)}/${what}`;
type Answer = { links: SiteLinksWire; changed?: number; merged?: boolean };

export const siteLinksApi = {
  get: (siteId: string) => apiGet<Answer>(path(siteId, 'links')).then(r => r.links),
  /** Renames a category; when another category already has the new name, the two become one. */
  rename: (siteId: string, from: string, to: string) => apiSend<Answer>(path(siteId, 'categories'), { from, to }),
  /** Puts one article in a category ('' takes it out of its category). */
  move: (siteId: string, articleId: number, to: string) => apiSend<Answer>(path(siteId, 'categories'), { articleId, to }),
};

export interface SiteLinksState {
  data: SiteLinksWire | null;
  /** Why it could not be read; '' while loading or when it was. */
  error: string;
  loading: boolean;
  /** Puts in the answer of a category action, which is the graph as it is now. */
  set: (d: SiteLinksWire) => void;
}

/**
 * The link graph of a site, read from the server while the page is connected to it and not in demo mode. `siteId`
 * undefined (no site) gives nothing.
 */
export function useSiteLinks(siteId: string | undefined): SiteLinksState {
  const on = useStore(s => s.live.on && !s.sample);
  /* Changes when an article of the site is written, edited, decided or moved to another category. */
  const stamp = useStore(s => siteId ? Object.values(s.live.arts).filter(a => a.siteId === siteId).map(a => a.id + ':' + a.updatedAt + ':' + a.status).join(',') : '');
  const [state, setState] = useState<{ id: string; data: SiteLinksWire | null; error: string }>({ id: '', data: null, error: '' });
  useEffect(() => {
    if (!on || !siteId) return;
    let stale = false;
    siteLinksApi.get(siteId).then(
      data => { if (!stale) setState({ id: siteId, data, error: '' }); },
      (e: unknown) => { if (!stale) setState({ id: siteId, data: null, error: e instanceof ApiError ? e.message : 'The links of this site could not be read.' }); },
    );
    return () => { stale = true; };
  }, [on, siteId, stamp]);
  const set = useCallback((d: SiteLinksWire) => setState({ id: d.siteId, data: d, error: '' }), []);
  const mine = on && !!siteId && state.id === siteId;
  return { data: mine ? state.data : null, error: mine ? state.error : '', loading: on && !!siteId && !mine, set };
}

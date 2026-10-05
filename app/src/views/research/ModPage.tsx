import { Callout, ModTable } from '@/components';
import { useStore } from '@/store/store';
import type { ModId } from '@/store/types';

/* The parts of the prototype's vTable(id), lines 1582-1590: the lede, the "not connected" callout and the table. */

/**
 * What a table is for, outside demo mode: one line that names the subject without claiming an agent already does the
 * work (the sample's ledes say "The Research agent maps…", which is the demo's story). Tables not listed keep theirs.
 */
const LIVE_LEDE: Partial<Record<ModId, string>> = {
  research: 'Competitors and content patterns in each country\'s search results.',
  keywords: 'The Keyword agent proposes and clusters keywords for one site at a time, in its country and language.',
  architecture: 'Silos and pillar pages for each site.',
  seo: 'On-page quality and how each page appears in search.',
  aio: 'Which queries show an AI Overview, and whether the site is cited.',
  cta: 'The call to action each page shows, by page intent and local offer.',
  experiments: 'Hypotheses and variants, measured from data.',
  ga4: 'Users and sessions from Google Analytics 4, one property per site.',
};

/** The table's description as the view's lede. */
export function ModLede({ id }: { id: ModId }) {
  const d = useStore(s => (s.sample ? undefined : LIVE_LEDE[id]) ?? s.mod[id].d);
  return <p className="lede">{d}</p>;
}

/** The module table in its <section>, with an optional heading. */
export function ModSection({ id, title }: { id: ModId; title?: string }) {
  return <section>{title ? <h2>{title}</h2> : null}<ModTable id={id} /></section>;
}

/** Shown when the integration the numbers come from (Search Console or GA4) has no account connected. */
export function SourceCallout({ need }: { need: 'gsc' | 'ga4' }) {
  const src = useStore(s => s.ints.find(x => x.id === need));
  const sample = useStore(s => s.sample);
  if (!src || src.tail) return null;
  return <Callout icon="link_off" warn><b>{src.name} is not connected.</b> {sample ? 'These numbers are the last data received and are no longer updating.' : 'Connect it in Integrations to see its data here.'}</Callout>;
}

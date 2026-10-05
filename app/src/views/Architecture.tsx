import { useStore } from '@/store/store';
import { CategoryTree } from './research/CategoryTree';
import { ModLede, ModSection } from './research/ModPage';
import { SiloTreeSection } from './research/SiloTreeSection';

/**
 * The Architecture tab of Research and SEO. On the Meridian server, outside demo mode: the site's real category tree
 * (categories and their articles, with counts), which an editor can rename and merge. In demo mode and without the
 * server: the prototype's lede, silo tree and silos table (vTable('architecture') and treeHTML(), lines 1538-1550 and 1582-1590).
 */
export function Architecture() {
  const real = useStore(s => s.live.on && !s.sample);
  if (real) {
    return (
      <>
        <p className="lede">Categories and their articles, one site at a time.</p>
        <CategoryTree />
      </>
    );
  }
  return (
    <>
      <ModLede id="architecture" />
      <SiloTreeSection />
      <ModSection id="architecture" title="Silos" />
    </>
  );
}

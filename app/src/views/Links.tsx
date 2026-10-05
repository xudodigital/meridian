import { Callout, Empty, Pill, Table } from '@/components';
import { useStore } from '@/store/store';
import type { LinkNodeWire, SiteLinksWire } from '@/store/types';
import { WRITE_A_LINK, graphKey, linkSite, siteGraphKey } from './research/graph';
import { LinkGraph } from './research/LinkGraph';
import { useSiteLinks } from './research/siteLinks';

const statusPill = (a: LinkNodeWire) => a.status === 'approved' ? <Pill kind="ok">Approved</Pill> : <Pill kind="info">In review</Pill>;

/** Articles of the same category that do not link to the orphan yet: where a link to it would fit best. */
function candidates(d: SiteLinksWire, orphan: LinkNodeWire): LinkNodeWire[] {
  const linked = new Set(d.links.filter(l => l.to === orphan.id).map(l => l.from));
  const others = d.articles.filter(a => a.id !== orphan.id && !linked.has(a.id));
  return [...others.filter(a => orphan.category && a.category === orphan.category), ...others.filter(a => !orphan.category || a.category !== orphan.category)].slice(0, 2);
}

/** Under the real graph: the articles no other article links to, every link in the text, and links that lead nowhere. */
function RealLists({ d }: { d: SiteLinksWire }) {
  const byId = new Map(d.articles.map(a => [a.id, a]));
  const orphans = d.orphans.map(id => byId.get(id)).filter((a): a is LinkNodeWire => !!a);
  const title = (id: number) => byId.get(id)?.title ?? 'An article that is no longer in review or approved';
  return (
    <>
      <section>
        <div className="sh"><h2>Articles no other article links to</h2><span className="note">{orphans.length} of {d.articles.length}</span></div>
        {orphans.length ? (
          <>
            <Table cols={['Article', 'Category', 'Status', 'Write a link from']} rows={orphans.map(a => {
              const from = candidates(d, a);
              return [<><b>{a.title}</b>{a.titleEn && a.titleEn !== a.title ? <span className="note" style={{ display: 'block' }}>{a.titleEn}</span> : null}</>, a.category || 'None', statusPill(a),
                from.length ? from.map(x => x.title).join(' · ') : 'No other article yet'];
            })} />
            <p className="note">{WRITE_A_LINK} Every article is still reachable from the home page and its category page; a link in the text of a related article tells readers and search engines how the two belong together.</p>
          </>
        ) : <Empty icon="link">{d.articles.length > 1 ? 'Every article has at least one link from another article.' : 'A site needs two articles before one can link to the other.'}</Empty>}
      </section>
      <section>
        <div className="sh"><h2>Links in the text</h2><span className="note">{d.links.length}</span></div>
        {d.links.length ? (
          <Table cols={['From', 'Linked words', 'To', 'On the website']} rows={d.links.map(l => [title(l.from), <b>{l.anchor}</b>, title(l.to),
            l.live ? <Pill kind="ok">Shown as a link</Pill> : <Pill kind="info">Plain text until both are approved</Pill>])} />
        ) : <Empty icon="add_link">No internal links yet. Add links in the article editor or request suggestions in SEO tasks.</Empty>}
        {d.broken.length ? (
          <Callout icon="link_off" warn><b>{d.broken.length} link{d.broken.length === 1 ? '' : 's'} lead to an article that is no longer in review or approved.</b> The website shows the words as plain text: {d.broken.map(b => `“${b.anchor}” in ${title(b.from)}`).join('; ')}.</Callout>
        ) : null}
      </section>
    </>
  );
}

/** The Internal links tab of Research and SEO: force-directed graph of a site's pages or of the agents. Prototype: vLinks() and the Graph section, lines 1704-1796. */
export function Links() {
  const gmode = useStore(s => s.gmode);
  const key = useStore(s => graphKey(s, s.gmode));
  /* Outside demo mode, on the Meridian server: the site's real links (server/links.ts). */
  const real = useStore(s => s.live.on && !s.sample);
  const site = useStore(s => linkSite(s));
  const all = useStore(s => s.siteFilter === 'all' && s.sites.length > 1);
  const links = useSiteLinks(real ? site?.id : undefined);
  const d = links.data;
  const linkMode = gmode === 'link';
  return (
    <>
      <p className="lede">Pages and the links between them, one site at a time.</p>
      {real && site && linkMode && !d ? (
        links.error ? <Callout icon="error" warn><b>The links of {site.domain} could not be read.</b> {links.error}</Callout> : <p className="note" role="status">Reading the links of {site.domain}…</p>
      ) : null}
      {real && site && linkMode && !d && !links.error ? null : <LinkGraph key={real && d && linkMode ? siteGraphKey(d) : key} mode={gmode} real={real ? d : null} />}
      {real && d && linkMode ? (
        <>
          {all ? <p className="note">Showing {site?.domain}. Pick another site at the top.</p> : null}
          <RealLists d={d} />
        </>
      ) : null}
    </>
  );
}

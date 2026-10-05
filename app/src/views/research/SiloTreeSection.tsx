import { Empty, Icon, Pill } from '@/components';
import { useStoreShallow } from '@/store/store';
import { siloTree, type SiloNode } from './siloTree';

const blocks = (n: number, k: string) => Array.from({ length: Math.max(0, n) }, (_, i) => <i key={k + i} className={'pg ' + k}></i>);

function Silo({ x }: { x: SiloNode }) {
  return (
    <li>
      <div className="st-pillar">
        <b>{x.name}</b>
        <span className="note"><code>{x.slug}</code> · {x.n} pages · click depth {x.depth}</span>
        {x.orphan ? <Pill kind="warn">{x.orphan + ' orphan pages'}</Pill> : null}
      </div>
      <div className="st-leaves" role="img" aria-label={`${x.published} published, ${x.draft} in draft, ${x.planned} planned${x.orphan ? ', ' + x.orphan + ' orphaned' : ''}`}>
        {blocks(x.published, 'p')}{blocks(x.draft, 'd')}{blocks(x.planned, 'n')}{blocks(x.orphan, 'o')}
      </div>
    </li>
  );
}

/**
 * The silo tree visual of Site architecture (the prototype's treeHTML()). In demo mode nothing is shown when no
 * site has silos; otherwise a sentence stands in for the tree.
 */
export function SiloTreeSection() {
  const [sample, sites, siteFilter, mod] = useStoreShallow(s => [s.sample, s.sites, s.siteFilter, s.mod] as const);
  const t = siloTree({ sites, siteFilter, mod });
  if (!t) {
    return sample ? null : (
      <section>
        <div className="sh"><h2>Silo tree</h2></div>
        <Empty icon="account_tree" title="No silo tree yet">{sites.length ? 'The Architect agent is planned and has no job yet, so no site has silos and pillar pages planned.' : 'There are no sites yet. The Architect agent, which would plan a site\'s silos, is planned and has no job yet.'}</Empty>
      </section>
    );
  }
  const T = t.total;
  return (
    <section>
      <div className="sh">
        <h2>Silo tree for {t.domain}</h2>
        <span className="note">{`${T.n} pages: ${T.published} published, ${T.draft} in draft, ${T.planned} planned${T.orphan ? ', ' + T.orphan + ' orphaned' : ''}`}</span>
      </div>
      <div className="stree">
        <span className="st-root"><Icon name="home" />Home <code>/</code></span>
        <ul>{t.silos.map(x => <Silo key={x.name} x={x} />)}</ul>
      </div>
      <div className="lg">
        <span><i className="pg p"></i>Published</span><span><i className="pg d"></i>In draft</span><span><i className="pg n"></i>Planned</span><span><i className="pg o"></i>Orphan, no internal links</span>
      </div>
      <p className="note">{siteFilter === 'all' ? 'Showing the first site. Pick a site in the top bar to see its tree. Each small block is one page.' : 'Each small block is one page under its pillar.'}</p>
    </section>
  );
}

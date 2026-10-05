import { Icon } from '@/components';
import { go } from '@/nav';
import { NAV } from '@/store/constants';
import { canSee, isRev, reviewCount } from '@/store/rules';
import { useStore } from '@/store/store';
import type { ViewId } from '@/store/types';

type NavEntry = readonly [ViewId, string, string];
const REVIEWER_NAV: readonly (readonly [string, readonly NavEntry[]])[] = [['Your work', [['review', 'Article review', 'rate_review']]]];

/** The side navigation (the prototype's renderNav): brand block, search shortcut and the module groups the role may see. */
export function SideNav({ view }: { view: ViewId }) {
  const session = useStore(s => s.session);
  const open = useStore(s => s.navOpen);
  const nSites = useStore(s => s.sites.length);
  const nAgents = useStore(s => s.agents.length);
  const nrev = useStore(reviewCount);
  const setSearchOpen = useStore(s => s.setSearchOpen);
  const groups = isRev(session) ? REVIEWER_NAV : NAV.map(g => [g[0], g[1].filter(v => canSee(session, v[0]))] as const).filter(g => g[1].length);
  return (
    <nav className={'side' + (open ? ' open' : '')} id="side" aria-label="Modules">
      <div className="brand"><span className="logo"><Icon name="hub" /></span><div><b>Meridian</b><span>{nSites} {nSites === 1 ? 'site' : 'sites'} · {nAgents} {nAgents === 1 ? 'agent' : 'agents'}</span></div></div>
      <button type="button" className="navsearch" onClick={() => setSearchOpen(true)}><Icon name="search" />Search<span className="kbd">Ctrl K</span></button>
      {groups.map(g => (
        <div className="navgroup" key={g[0]}>
          <h2>{g[0]}</h2>
          {g[1].map(v => (
            <button type="button" key={v[0]} aria-current={view === v[0] ? 'page' : undefined} onClick={() => go(v[0])}>
              <Icon name={v[2]} />{v[1]}
              {v[0] === 'review' && nrev ? <span className="count" aria-label={nrev + ' waiting'}>{nrev}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

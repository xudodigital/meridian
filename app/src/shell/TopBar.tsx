import { Icon, Select, type SelectOption } from '@/components';
import { MotionControl } from './MotionControl';
import { TITLES } from '@/store/constants';
import { initials, isRev, revSite, siteById, unreadCount } from '@/store/rules';
import { useStore } from '@/store/store';
import type { ViewId } from '@/store/types';

/** The top app bar: menu button, title, site picker, search, notifications bell and account button. */
export function TopBar({ view, scrolled }: { view: ViewId; scrolled: boolean }) {
  const session = useStore(s => s.session);
  const sites = useStore(s => s.sites);
  const siteFilter = useStore(s => s.siteFilter);
  const unread = useStore(unreadCount);
  const setSiteFilter = useStore(s => s.setSiteFilter);
  const setNavOpen = useStore(s => s.setNavOpen);
  const setSearchOpen = useStore(s => s.setSearchOpen);
  const setPop = useStore(s => s.setPop);
  const mySite = useStore(revSite);

  /* A native reviewer sees one site; everyone else can pick any site or all of them (the prototype's renderSiteSel). */
  const rev = isRev(session);
  const opt = (s: { id: string; domain: string; country: string }): SelectOption => ({ value: s.id, label: `${s.domain} (${s.country})` });
  let options: SelectOption[], value: string;
  if (rev) {
    const mine = sites.filter(s => s.id === mySite).map(opt);
    options = mine.length ? mine : [{ value: 'all', label: 'No site assigned' }];
    value = mine.length ? mySite : 'all';
  } else {
    options = [{ value: 'all', label: 'All sites' }, ...sites.map(opt)];
    value = siteFilter !== 'all' && !siteById({ sites }, siteFilter) ? 'all' : siteFilter;
  }

  return (
    <header className={'top' + (scrolled ? ' scrolled' : '')} id="top">
      <button type="button" className="ib" id="menuBtn" aria-label="Open module menu" onClick={() => setNavOpen(true)}><Icon name="menu" /></button>
      <h1 id="title">{TITLES[view]}</h1>
      {/* With one site or none there is nothing to pick between (a reviewer still sees which site is theirs). */}
      {rev || sites.length > 1 || value !== 'all' ? (
        <div className="sitepick">
          <Select id="siteSel" label="Site" icon="language" searchPlaceholder={sites.length > 100 ? 'Search 100+ sites by name or country' : 'Search sites by name or country'} value={value} options={options} onChange={setSiteFilter} />
        </div>
      ) : null}
      <MotionControl />
      <button type="button" className="ib" data-act="search" aria-label="Search" title="Search (Ctrl or Cmd + K)" onClick={() => setSearchOpen(true)}><Icon name="search" /></button>
      <button type="button" className="ib bell" id="bellBtn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" onClick={() => setPop('notif')}>
        <Icon name="notifications" /><span className="badge" id="bellN" hidden={!unread}>{unread > 9 ? '9+' : unread}</span>
      </button>
      <button type="button" className="me" id="meBtn" aria-label="Account" title="Account" onClick={() => setPop('menu')}>{session ? initials(session.name) : ''}</button>
    </header>
  );
}

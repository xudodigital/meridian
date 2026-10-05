import { useState, type FormEvent } from 'react';
import { Dialog, Empty, Icon } from '@/components';
import { go } from '@/nav';
import { ALIAS, ALIAS_IDS, AST, NAV, TITLES } from '@/store/constants';
import { artOpen, artVisible, canSee, canSeeTab, siteById } from '@/store/rules';
import { useStore, type AppStore } from '@/store/store';
import type { Article } from '@/store/types';

interface Result { icon: string; label: string; sub: string; run: () => void }

/** The prototype's searchIndex(): modules, their tabs that have a name of their own (Rank tracking, Audit log, ...), sites, agents and articles the role may open. */
function searchIndex(s: AppStore): Result[] {
  const out: Result[] = [];
  const openArticle = (id: Article['id'], open: boolean, widen: boolean) => {
    useStore.setState(d => { if (widen) d.siteFilter = 'all'; d.rtab = open ? 'open' : 'done'; d.rsel = id; d.rdetail = true; });
    go('review');
  };
  if (s.session?.role === 'reviewer') {
    s.articles.filter(a => artVisible(s, a)).forEach(a => out.push({ icon: 'article', label: a.titleEn, sub: 'Article · ' + AST[a.status][1], run: () => openArticle(a.id, artOpen(a), false) }));
    return out;
  }
  NAV.forEach(g => g[1].forEach(v => { if (canSee(s.session, v[0])) out.push({ icon: v[2], label: v[1], sub: 'Module · ' + g[0], run: () => go(v[0]) }); }));
  ALIAS_IDS.forEach(k => { if (canSeeTab(s.session, k)) out.push({ icon: ALIAS[k].icon ?? 'tab', label: ALIAS[k].label, sub: 'Section in ' + TITLES[ALIAS[k].view], run: () => go(k) }); });
  s.sites.forEach(x => out.push({
    icon: 'language', label: x.domain, sub: `Site · ${x.country} · ${x.topic}`,
    run: () => { useStore.setState(d => { d.siteFilter = 'all'; d.sq = x.domain; d.sst = ''; d.sco = ''; d.pg.sites = 0; }); go('sites'); },
  }));
  s.agents.forEach(a => out.push({ icon: 'smart_toy', label: a.name, sub: 'Agent · ' + a.role, run: () => { go('workspace'); useStore.getState().openAgent(a.id); } }));
  s.articles.filter(a => siteById(s, a.s) || a.live).forEach(a => out.push({ icon: 'article', label: a.titleEn, sub: 'Article · ' + AST[a.status][1], run: () => openArticle(a.id, artOpen(a), !artVisible(s, a)) }));
  return out;
}

function SearchForm({ close }: { close: () => void }) {
  const [q, setQ] = useState('');
  const store = useStore();
  const needle = q.trim().toLowerCase(), all = searchIndex(store);
  /* Empty query: the first six entries. Otherwise up to eight matches on label and description. */
  const found = (needle ? all.filter(r => (r.label + ' ' + r.sub).toLowerCase().includes(needle)) : all.slice(0, 6)).slice(0, 8);
  const pick = (r: Result | undefined) => { close(); r?.run(); };
  const submit = (e: FormEvent) => { e.preventDefault(); pick(found[0]); };
  return (
    <form onSubmit={submit}>
      <div className="sbox">
        <Icon name="search" />
        <input type="text" id="q" autoComplete="off" autoFocus placeholder="Search modules, sites, agents and articles" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="nlist" id="results">
        {found.length ? found.map((r, i) => (
          <button type="button" className="nt" key={i} onClick={() => pick(r)}>
            <span className="ni info"><Icon name={r.icon} /></span>
            <span><b>{r.label}</b><span className="b">{r.sub}</span></span>
          </button>
        )) : <Empty>No matches. Try a site, agent or module name.</Empty>}
      </div>
    </form>
  );
}

/** The global search dialog (the prototype's #search). Opens from the top bar, the side navigation, and Ctrl or Cmd + K. Enter opens the first result. */
export function SearchDialog() {
  const open = useStore(s => s.searchOpen);
  const setOpen = useStore(s => s.setSearchOpen);
  const close = () => setOpen(false);
  return (
    <Dialog id="search" label="Search" open={open} onClose={close} backdropClose>
      <SearchForm close={close} />
    </Dialog>
  );
}

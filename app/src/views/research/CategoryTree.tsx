/* The real category tree of a site on the Architecture tab (outside demo mode): Home, the site's categories and the
   articles in each, with counts, from the server (server/links.ts). An editor renames a category (which merges it into
   another one when that name is taken) and puts an article in another category. A category is not part of an
   article's text, so neither sends an article back to review; the next website build uses the new names. */
import { useState } from 'react';
import { Button, Callout, Dialog, Empty, Field, Icon, Pill, SheetActions } from '@/components';
import { ApiError } from '@/store/serverApi';
import { useStore } from '@/store/store';
import type { LinkNodeWire, SiteLinksWire } from '@/store/types';
import { linkSite } from './graph';
import { siteLinksApi, useSiteLinks } from './siteLinks';
import './categoryTree.css';

const CATEGORY_MAX = 60;
const same = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().toLocaleLowerCase() === b.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const n1 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the dialog changes: the name of a category, or the category of one article. */
type Change = { kind: 'rename'; from: string } | { kind: 'move'; article: LinkNodeWire };

function ArticleRow({ a, onMove }: { a: LinkNodeWire; onMove?: () => void }) {
  return (
    <li className="ct-a">
      <span className="ct-t">{a.title}{a.titleEn && a.titleEn !== a.title ? <span className="note"> · {a.titleEn}</span> : null}</span>
      {a.status === 'approved' ? <Pill kind="ok">Approved</Pill> : <Pill kind="info">In review</Pill>}
      <span className="note">{n1(a.in, 'link', 'links')} in, {a.out} out</span>
      {onMove ? <button type="button" className="linkbtn" onClick={onMove} aria-label={`Change the category of ${a.title}`}>Change category</button> : null}
    </li>
  );
}

function ChangeForm({ d, change, onDone, onCancel }: { d: SiteLinksWire; change: Change; onDone: (next: SiteLinksWire, said: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(change.kind === 'rename' ? change.from : change.article.category);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const clean = name.replace(/\s+/g, ' ').trim();
  const from = change.kind === 'rename' ? change.from : '';
  /* Renaming to the name of another category makes the two one. */
  const into = change.kind === 'rename' ? d.categories.find(k => !same(k.name, from) && same(k.name, clean)) : undefined;
  const unchanged = change.kind === 'rename' ? clean === from : clean === change.article.category;
  const submit = async () => {
    if (busy) return;
    if (change.kind === 'rename' && !clean) { setErr('Enter the new name of the category.'); return; }
    if ([...clean].length > CATEGORY_MAX) { setErr(`A category name has at most ${CATEGORY_MAX} characters.`); return; }
    if (clean && !/[\p{L}\p{N}]/u.test(clean)) { setErr('A category needs at least one letter or number.'); return; }
    setBusy(true); setErr('');
    try {
      const r = change.kind === 'rename' ? await siteLinksApi.rename(d.siteId, from, clean) : await siteLinksApi.move(d.siteId, change.article.id, clean);
      onDone(r.links, change.kind === 'move' ? (clean ? `Moved to “${clean}”.` : 'Taken out of its category.') : r.merged ? `Merged “${from}” into “${clean}”.` : `Renamed to “${clean}”.`);
    } catch (e) { setBusy(false); setErr(e instanceof ApiError ? e.message : 'The change could not be saved. Try again.'); }
  };
  return (
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <h2 id="ctDlgT">{change.kind === 'rename' ? `Rename “${from}”` : 'Change the category'}</h2>
      <p>{change.kind === 'rename' ? 'Every article of this category gets the new name. Write it in the site\'s language: it is shown on the website.' : change.article.title}</p>
      <Field label={change.kind === 'rename' ? 'New name' : 'Category'}>
        <input type="text" value={name} maxLength={CATEGORY_MAX} list="ctCats" autoFocus placeholder={change.kind === 'move' ? 'No category' : undefined} onChange={e => { setName(e.target.value); setErr(''); }} />
      </Field>
      <datalist id="ctCats">{d.allCategories.filter(k => !same(k, from)).map(k => <option key={k} value={k} />)}</datalist>
      {change.kind === 'move' ? <p className="note">Choose one of the site's categories or type a new one. Leave it empty for no category.</p> : null}
      {into ? <Callout icon="merge" warn><b>“{into.name}” already exists.</b> The two categories become one, named “{clean}”, with {n1(into.articles.length + (d.categories.find(k => same(k.name, from))?.articles.length ?? 0), 'article', 'articles')}. This cannot be undone in one step.</Callout> : null}
      <p className="note">The website changes with its next build. The address of a category page comes from its name, so a renamed category gets a new address.</p>
      {err ? <p className="err" role="alert">{err}</p> : null}
      <SheetActions>
        <Button variant="text" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="filled" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : into ? 'Merge categories' : change.kind === 'rename' ? 'Rename' : 'Save'}</Button>
      </SheetActions>
    </form>
  );
}

/** The category tree of the site in the site filter (else the first site). */
export function CategoryTree() {
  const site = useStore(s => linkSite(s));
  const all = useStore(s => s.siteFilter === 'all' && s.sites.length > 1);
  const mayWrite = useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');
  const snack = useStore(s => s.snack);
  const links = useSiteLinks(site?.id);
  const [change, setChange] = useState<Change | null>(null);
  const d = links.data;
  if (!site) return <section><div className="sh"><h2>Category tree</h2></div><Empty icon="account_tree" title="No sites yet">Add a site in Sites. Its categories appear here once it has articles.</Empty></section>;
  if (!d) {
    return (
      <section>
        <div className="sh"><h2>Category tree for {site.domain}</h2></div>
        {links.error ? <Callout icon="error" warn><b>The categories of {site.domain} could not be read.</b> {links.error}</Callout> : <p className="note" role="status">Reading the categories of {site.domain}…</p>}
      </section>
    );
  }
  const byId = new Map(d.articles.map(a => [a.id, a]));
  const arts = (ids: readonly number[]) => ids.map(id => byId.get(id)).filter((a): a is LinkNodeWire => !!a);
  const approved = d.articles.filter(a => a.status === 'approved').length;
  const move = (a: LinkNodeWire) => mayWrite ? () => setChange({ kind: 'move', article: a }) : undefined;
  return (
    <section>
      <div className="sh">
        <h2>Category tree for {d.domain || site.domain}</h2>
        <span className="note">{d.articles.length ? `${n1(d.categories.length, 'category', 'categories')}, ${n1(d.articles.length, 'article', 'articles')}: ${approved} approved, ${d.articles.length - approved} in review` : 'No articles yet'}</span>
      </div>
      {d.articles.length ? (
        <div className="stree ct">
          <span className="st-root"><Icon name="home" />Home <code>/</code></span>
          <ul>
            {d.categories.map(k => (
              <li key={k.name}>
                <div className="st-pillar">
                  <b>{k.name}</b>
                  <span className="note"><code>/{k.slug}/</code> · {n1(k.articles.length, 'article', 'articles')} · {k.approved} approved</span>
                  {mayWrite ? <button type="button" className="linkbtn" onClick={() => setChange({ kind: 'rename', from: k.name })} aria-label={`Rename the category ${k.name}`}>Rename or merge</button> : null}
                </div>
                <ul className="ct-list">{arts(k.articles).map(a => <ArticleRow key={a.id} a={a} onMove={move(a)} />)}</ul>
              </li>
            ))}
            {d.uncategorized.length ? (
              <li>
                <div className="st-pillar"><b>No category</b><span className="note">{n1(d.uncategorized.length, 'article', 'articles')} · linked from the home page only</span></div>
                <ul className="ct-list">{arts(d.uncategorized).map(a => <ArticleRow key={a.id} a={a} onMove={move(a)} />)}</ul>
              </li>
            ) : null}
          </ul>
        </div>
      ) : <Empty icon="account_tree" title="No categories yet">{site.domain} has no article in review or approved yet. The Content Writer proposes a category for each article it writes; the tree appears here.</Empty>}
      {d.articles.length ? (
        <p className="note">
          {all ? `Showing ${site.domain}. Pick another site at the top. ` : ''}
          Each category has a page on the website that lists its articles, and an article's breadcrumbs lead through it. The navigation shows the categories once a site has two.
          {d.categories.length === 1 && !d.uncategorized.length ? ' This site has one category so far.' : ''}
        </p>
      ) : null}
      <Dialog open={!!change} onClose={() => setChange(null)} labelledBy="ctDlgT" className="ct-dlg" backdropClose>
        {change ? <ChangeForm d={d} change={change} onCancel={() => setChange(null)} onDone={(next, said) => { links.set(next); setChange(null); snack(said, 'account_tree'); }} /> : null}
      </Dialog>
    </section>
  );
}
